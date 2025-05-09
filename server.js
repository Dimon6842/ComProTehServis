const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { saveOrder, saveContactMessage, insertUser, getUserByEmail, verifyPassword, updateUser, changeUserPassword, setTwoFactorSecret, setTwoFactorEnabled, saveReview, deleteReview, getReviews, getUserOrders, getOrderById, updateOrderStatus, updateOrderPrice } = require('./database');

const app = express();
const port = 3000;

// Хранилище для отслеживания активных запросов оплаты
const activePaymentRequests = new Set();

// Настройка multer для загрузки файлов
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = 'public/image/avatars/';
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `avatar-${req.session.user.id}-${Date.now()}${ext}`);
    }
});
const upload = multer({ storage });

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(session({
    secret: 'secretKey',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // Установите secure: true в продакшене с HTTPS
}));

// Middleware для защиты маршрутов
app.use((req, res, next) => {
    const publicPaths = ['/', '/login.html', '/register.html', '/login', '/register', '/api/orders', '/api/contact', '/api/reviews', '/api/2fa/setup', '/api/2fa/verify', '/api/2fa/login'];
    if (!publicPaths.includes(req.path) && !req.session.user && !req.path.startsWith('/api/orders/')) {
        return res.redirect('/login.html');
    }
    next();
});

// Роут для обработки заказов
app.post('/api/orders', async (req, res) => {
    const { name, email, telegram, service, message } = req.body;
    const user_id = req.session.user ? req.session.user.id : null;

    if (!name || !email || !telegram || !service) {
        return res.status(400).json({ message: 'Пожалуйста, заполните все обязательные поля.' });
    }

    const services = [{ name: service, price: null }];

    try {
        await saveOrder({ user_id, name, email, telegram, service, message, payment_status: 'pending', services });
        res.json({ message: 'Заказ успешно отправлен!' });
    } catch (err) {
        console.error('Ошибка при сохранении заказа:', err);
        res.status(500).json({ message: 'Ошибка сервера. Попробуйте позже.' });
    }
});

// Роут для получения деталей заказа
app.get('/api/orders/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Не авторизован' });
    }

    const orderId = req.params.id;

    try {
        console.log(`Запрос деталей заказа #${orderId} для пользователя ${req.session.user.id}`);
        const order = await getOrderById(orderId, req.session.user.id);
        if (!order) {
            console.log(`Заказ #${orderId} не найден`);
            return res.status(404).json({ error: 'Заказ не найден или не принадлежит вам' });
        }
        res.json(order);
    } catch (err) {
        console.error('Ошибка при получении заказа:', err);
        res.status(500).json({ error: 'Ошибка сервера', details: err.message });
    }
});

// Роут для обработки оплаты заказа
app.post('/api/orders/pay/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Не авторизован' });
    }

    const orderId = req.params.id;
    const requestKey = `${req.session.user.id}:${orderId}`;

    // Проверка на дублирующиеся запросы
    if (activePaymentRequests.has(requestKey)) {
        console.log(`Повторный запрос на оплату заказа #${orderId} отклонён`);
        return res.status(429).json({ error: 'Запрос на оплату уже обрабатывается' });
    }

    activePaymentRequests.add(requestKey);

    try {
        console.log(`Начало обработки оплаты для заказа #${orderId}, пользователь: ${req.session.user.id}`);
        const order = await getOrderById(orderId, req.session.user.id);
        if (!order) {
            console.log(`Заказ #${orderId} не найден или не принадлежит пользователю ${req.session.user.id}`);
            return res.status(404).json({ error: 'Заказ не найден или не принадлежит вам' });
        }
        if (order.payment_status === 'paid') {
            console.log(`Заказ #${orderId} уже оплачен`);
            return res.status(400).json({ error: 'Заказ уже оплачен' });
        }
        if (order.total_amount == null) {
            console.log(`Сумма заказа #${orderId} не указана`);
            return res.status(400).json({ error: 'Сумма заказа не указана' });
        }

        console.log(`Обновление статуса оплаты для заказа #${orderId} на 'paid'`);
        const changes = await updateOrderStatus(orderId, order.status, 'paid');
        if (changes === 0) {
            console.log(`Заказ #${orderId} не найден при обновлении статуса`);
            return res.status(404).json({ error: 'Заказ не найден' });
        }
        console.log(`Оплата заказа #${orderId} успешно проведена`);
        res.json({ message: 'Оплата успешно проведена' });
    } catch (err) {
        console.error('Ошибка при обработке оплаты:', {
            message: err.message,
            stack: err.stack,
            orderId,
            userId: req.session.user.id
        });
        res.status(500).json({ error: 'Ошибка сервера', details: err.message });
    } finally {
        activePaymentRequests.delete(requestKey);
        console.log(`Запрос на оплату заказа #${orderId} завершён`);
    }
});

// Роут для обновления цены заказа (для админов)
app.post('/api/orders/:id/price', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Не авторизован или недостаточно прав' });
    }

    const orderId = req.params.id;
    const { total_amount } = req.body;

    if (!total_amount || isNaN(total_amount) || total_amount <= 0) {
        return res.status(400).json({ error: 'Укажите корректную сумму' });
    }

    try {
        console.log(`Обновление цены для заказа #${orderId}: ${total_amount}`);
        const changes = await updateOrderPrice(orderId, parseFloat(total_amount));
        if (changes === 0) {
            console.log(`Заказ #${orderId} не найден`);
            return res.status(404).json({ error: 'Заказ не найден' });
        }
        console.log(`Цена заказа #${orderId} обновлена`);
        res.json({ message: 'Цена заказа успешно обновлена' });
    } catch (err) {
        console.error('Ошибка при обновлении цены заказа:', err);
        res.status(500).json({ error: 'Ошибка сервера', details: err.message });
    }
});

// Роут для получения заказов пользователя
app.get('/api/orders', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Не авторизован' });
    }

    try {
        console.log(`Получение заказов для пользователя ${req.session.user.id}`);
        const orders = await getUserOrders(req.session.user.id);
        res.json(orders);
    } catch (err) {
        console.error('Ошибка при получении заказов:', err);
        res.status(500).json({ error: 'Ошибка сервера', details: err.message });
    }
});

// Роут для обработки сообщений из формы "Связаться с нами"
app.post('/api/contact', async (req, res) => {
    const { name, email, telegram, message } = req.body;

    if (!name || !email || !message) {
        return res.status(400).json({ error: 'Имя, email и сообщение обязательны' });
    }

    try {
        await saveContactMessage({ name, email, telegram, message });
        res.status(200).json({ message: 'Сообщение успешно сохранено' });
    } catch (error) {
        console.error('Ошибка при сохранении сообщения:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

// Регистрация
app.post('/register', async (req, res) => {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ success: false, message: 'Заполните все поля' });
    }

    try {
        const existingUser = await getUserByEmail(email);
        if (existingUser) {
            return res.status(400).json({ success: false, message: 'Пользователь с таким email уже существует' });
        }

        const userId = await insertUser(name, email, password);
        req.session.user = { id: userId, name, email, avatar: 'image/avatar.png', justRegistered: true, two_factor_enabled: 0 };
        res.json({ success: true, redirect: '/dashboard.html' });
    } catch (err) {
        console.error('Ошибка при регистрации:', err);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// Вход
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Введите email и пароль' });
    }

    try {
        const user = await getUserByEmail(email);
        if (!user) {
            return res.status(401).json({ success: false, message: 'Неверный email или пароль' });
        }

        const isPasswordValid = await verifyPassword(email, password);
        if (!isPasswordValid) {
            return res.status(401).json({ success: false, message: 'Неверный email или пароль' });
        }

        if (user.two_factor_enabled) {
            req.session.tempUser = { id: user.id, name: user.name, email: user.email, avatar: user.avatar, two_factor_enabled: 1 };
            return res.json({ success: true, twoFactorRequired: true });
        }

        req.session.user = { id: user.id, name: user.name, email: user.email, avatar: user.avatar, justRegistered: false, two_factor_enabled: user.two_factor_enabled };
        res.json({ success: true, redirect: '/dashboard.html' });
    } catch (err) {
        console.error('Ошибка при входе:', err);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

// Проверка 2FA при входе
app.post('/api/2fa/login', async (req, res) => {
    const { code } = req.body;

    if (!req.session.tempUser) {
        return res.status(401).json({ error: 'Сессия истекла' });
    }

    try {
        const user = await getUserByEmail(req.session.tempUser.email);
        if (!user || !user.two_factor_secret) {
            return res.status(400).json({ error: '2FA не настроена' });
        }

        const verified = speakeasy.totp.verify({
            secret: user.two_factor_secret,
            encoding: 'base32',
            token: code
        });

        if (!verified) {
            return res.status(400).json({ error: 'Неверный код 2FA' });
        }

        req.session.user = { id: user.id, name: user.name, email: user.email, avatar: user.avatar, justRegistered: false, two_factor_enabled: user.two_factor_enabled };
        delete req.session.tempUser;
        res.json({ success: true, redirect: '/dashboard.html' });
    } catch (err) {
        console.error('Ошибка при проверке 2FA:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Настройка 2FA
app.get('/api/2fa/setup', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Не авторизован' });
    }

    try {
        const secret = speakeasy.generateSecret({
            name: `ComProTehServis:${req.session.user.email}`
        });

        await setTwoFactorSecret(req.session.user.id, secret.base32);

        QRCode.toDataURL(secret.otpauth_url, (err, data_url) => {
            if (err) {
                console.error('Ошибка при генерации QR-кода:', err);
                return res.status(500).json({ error: 'Ошибка сервера' });
            }
            res.json({ qrCode: data_url, secret: secret.base32 });
        });
    } catch (err) {
        console.error('Ошибка при настройке 2FA:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Проверка кода 2FA
app.post('/api/2fa/verify', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Не авторизован' });
    }

    const { code } = req.body;

    try {
        const user = await getUserByEmail(req.session.user.email);
        if (!user || !user.two_factor_secret) {
            return res.status(400).json({ error: '2FA не настроена' });
        }

        const verified = speakeasy.totp.verify({
            secret: user.two_factor_secret,
            encoding: 'base32',
            token: code
        });

        if (!verified) {
            return res.status(400).json({ error: 'Неверный код 2FA' });
        }

        await setTwoFactorEnabled(req.session.user.id, true);
        req.session.user.two_factor_enabled = 1;
        res.json({ success: true, message: '2FA успешно включена' });
    } catch (err) {
        console.error('Ошибка при проверке 2FA:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Отключение 2FA
app.post('/api/2fa/disable', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Не авторизован' });
    }

    try {
        await setTwoFactorEnabled(req.session.user.id, false);
        req.session.user.two_factor_enabled = 0;
        res.json({ success: true, message: '2FA успешно отключена' });
    } catch (err) {
        console.error('Ошибка при отключении 2FA:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Профиль пользователя
app.get('/profile', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Не авторизован' });
    }

    try {
        const user = await getUserByEmail(req.session.user.email);
        res.json({
            name: user.name,
            email: user.email,
            phone: user.phone || '',
            address: user.address || '',
            avatar: user.avatar || 'image/avatar.png',
            justRegistered: req.session.user.justRegistered || false,
            two_factor_enabled: user.two_factor_enabled
        });
    } catch (err) {
        console.error('Ошибка при получении профиля:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Обновление профиля с загрузкой аватарки
app.post('/profile', upload.single('avatar'), async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Не авторизован' });
    }

    const { name, email, phone, address } = req.body;
    let avatar = req.session.user.avatar;

    if (req.file) {
        const oldAvatar = req.session.user.avatar;
        avatar = `image/avatars/${req.file.filename}`;
        if (oldAvatar && oldAvatar !== 'image/avatar.png') {
            const oldAvatarPath = path.join(__dirname, 'public', oldAvatar);
            if (fs.existsSync(oldAvatarPath)) {
                fs.unlinkSync(oldAvatarPath);
            }
        }
    }

    try {
        await updateUser(req.session.user.id, name, email, phone, address, avatar);
        req.session.user = { ...req.session.user, name, email, avatar, phone, address, justRegistered: false };
        res.json({ success: true, message: 'Профиль обновлен', avatar });
    } catch (err) {
        console.error('Ошибка при обновлении профиля:', err);
        res.status(500).json({ error: 'Ошибка сервера при обновлении профиля' });
    }
});

// Смена пароля
app.post('/api/change-password', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Не авторизован' });
    }

    const { currentPassword, newPassword, confirmNewPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmNewPassword) {
        return res.status(400).json({ error: 'Все поля обязательны' });
    }

    if (newPassword !== confirmNewPassword) {
        return res.status(400).json({ error: 'Новые пароли не совпадают' });
    }

    try {
        const isPasswordValid = await verifyPassword(req.session.user.email, currentPassword);
        if (!isPasswordValid) {
            return res.status(401).json({ error: 'Неверный текущий пароль' });
        }

        await changeUserPassword(req.session.user.id, newPassword);
        res.json({ message: 'Пароль успешно изменен' });
    } catch (err) {
        console.error('Ошибка при смене пароля:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Сохранение отзыва
app.post('/api/reviews', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Не авторизован' });
    }

    const { rating, comment } = req.body;

    if (!rating || !comment) {
        return res.status(400).json({ error: 'Рейтинг и комментарий обязательны' });
    }

    try {
        await saveReview(req.session.user.id, rating, comment);
        res.json({ message: 'Отзыв успешно сохранен' });
    } catch (err) {
        console.error('Ошибка при сохранении отзыва:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Удаление отзыва
app.delete('/api/reviews/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Не авторизован' });
    }

    const reviewId = req.params.id;

    try {
        const changes = await deleteReview(reviewId, req.session.user.id);
        if (changes === 0) {
            return res.status(403).json({ error: 'Вы не можете удалить этот отзыв' });
        }
        res.json({ message: 'Отзыв успешно удален' });
    } catch (err) {
        console.error('Ошибка при удалении отзыва:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Получение отзывов
app.get('/api/reviews', async (req, res) => {
    try {
        const reviews = await getReviews();
        res.json(reviews);
    } catch (err) {
        console.error('Ошибка при получении отзывов:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

// Выход
app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Ошибка при выходе:', err);
            return res.status(500).json({ error: 'Ошибка сервера' });
        }
        res.redirect('/login.html');
    });
});

// Отмена заказа
app.post('/api/orders/cancel/:id', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Не авторизован' });
    }

    const orderId = req.params.id;

    try {
        console.log(`Отмена заказа #${orderId} для пользователя ${req.session.user.id}`);
        const changes = await updateOrderStatus(orderId, 'cancelled');
        if (changes === 0) {
            console.log(`Заказ #${orderId} не найден`);
            return res.status(404).json({ error: 'Заказ не найден или не принадлежит вам' });
        }
        console.log(`Заказ #${orderId} успешно отменён`);
        res.json({ message: 'Заказ успешно отменен' });
    } catch (err) {
        console.error('Ошибка при отмене заказа:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.listen(port, () => {
    console.log(`Сервер запущен на http://localhost:${port}`);
});

app.get('/api/session', (req, res) => {
    if (req.session.user) {
      const { id, name, avatar } = req.session.user;
      res.json({ id, name, avatar });
    } else {
      res.json(null);
    }
});
  
app.get('/logout', (req, res) => {
    req.session.destroy(() => {
      res.redirect('/');
    });
});