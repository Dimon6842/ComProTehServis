const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');

// Очередь для операций с базой
const dbQueue = [];
let isProcessingQueue = false;

// Инициализация базы данных
const db = new sqlite3.Database('./orders.db', (err) => {
    if (err) {
        console.error('Ошибка при подключении к базе данных:', err);
    }
});

// Увеличенный таймаут для занятой базы
db.configure('busyTimeout', 10000);

// Функция обработки очереди
function processQueue() {
    if (isProcessingQueue || dbQueue.length === 0) return;
    isProcessingQueue = true;

    const { query, params, resolve, reject } = dbQueue.shift();
    console.log(`Выполнение запроса из очереди: ${query.substring(0, 50)}...`);

    db.run(query, params, function (err) {
        isProcessingQueue = false;
        if (err) {
            console.error('Ошибка в очереди:', err);
            reject(err);
        } else {
            resolve(this);
        }
        processQueue(); // Обрабатываем следующий запрос
    });
}

// Функция добавления запроса в очередь
function enqueueQuery(query, params) {
    return new Promise((resolve, reject) => {
        dbQueue.push({ query, params, resolve, reject });
        processQueue();
    });
}

// Проверка и добавление столбца avatar в таблицу users
function ensureAvatarColumn() {
    return new Promise((resolve, reject) => {
        db.all("PRAGMA table_info(users)", (err, columns) => {
            if (err) return reject(err);
            const hasAvatar = columns.some(column => column.name === 'avatar');
            if (!hasAvatar) {
                enqueueQuery(`ALTER TABLE users ADD COLUMN avatar TEXT`)
                    .then(() => {
                        enqueueQuery(`UPDATE users SET avatar = 'image/avatar.png' WHERE avatar IS NULL`)
                            .then(() => resolve())
                            .catch(reject);
                    })
                    .catch(reject);
            } else {
                resolve();
            }
        });
    });
}

// Проверка и добавление столбцов для 2FA
function ensureTwoFactorColumns() {
    return new Promise((resolve, reject) => {
        db.all("PRAGMA table_info(users)", (err, columns) => {
            if (err) return reject(err);
            const hasTwoFactorSecret = columns.some(column => column.name === 'two_factor_secret');
            const hasTwoFactorEnabled = columns.some(column => column.name === 'two_factor_enabled');
            const queries = [];
            if (!hasTwoFactorSecret) {
                queries.push(enqueueQuery(`ALTER TABLE users ADD COLUMN two_factor_secret TEXT`));
            }
            if (!hasTwoFactorEnabled) {
                queries.push(enqueueQuery(`ALTER TABLE users ADD COLUMN two_factor_enabled INTEGER DEFAULT 0`));
            }
            Promise.all(queries).then(resolve).catch(reject);
        });
    });
}

// Проверка и добавление новых столбцов в таблицу orders
function ensureOrderColumns() {
    return new Promise((resolve, reject) => {
        db.all("PRAGMA table_info(orders)", (err, columns) => {
            if (err) return reject(err);

            const columnsToAdd = [
                { name: 'status', type: 'TEXT DEFAULT "processing"' },
                { name: 'total_amount', type: 'REAL' },
                { name: 'payment_status', type: 'TEXT DEFAULT "pending"' },
                { name: 'services', type: 'TEXT' },
                { name: 'user_id', type: 'INTEGER' }
            ];

            const existingColumns = columns.map(col => col.name);
            const addColumnPromises = columnsToAdd
                .filter(col => !existingColumns.includes(col.name))
                .map(col => enqueueQuery(`ALTER TABLE orders ADD COLUMN ${col.name} ${col.type}`));

            Promise.all(addColumnPromises)
                .then(() => resolve())
                .catch(reject);
        });
    });
}

// Создание таблиц
db.run(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  email TEXT UNIQUE,
  password TEXT,
  phone TEXT,
  address TEXT,
  avatar TEXT DEFAULT 'image/avatar.png',
  two_factor_secret TEXT,
  two_factor_enabled INTEGER DEFAULT 0
)`);

db.run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    name TEXT,
    email TEXT,
    telegram TEXT,
    service TEXT,
    message TEXT,
    status TEXT DEFAULT 'processing',
    total_amount REAL,
    payment_status TEXT DEFAULT 'pending',
    services TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
)`);

db.run(`CREATE TABLE IF NOT EXISTS contact_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT,
    telegram TEXT,
    message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

db.run(`CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    rating INTEGER,
    comment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
)`);

// Создание индексов для ускорения запросов
db.run(`CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_orders_id ON orders(id)`);

// Выполняем проверку и добавление столбцов
Promise.all([ensureAvatarColumn(), ensureTwoFactorColumns(), ensureOrderColumns()])
    .catch(err => {
        console.error('Ошибка при инициализации базы данных:', err);
    });

// Функция для выполнения операции с повторными попытками при SQLITE_BUSY
function runWithRetry(query, params, maxRetries = 3, retryDelay = 500) {
    return new Promise((resolve, reject) => {
        let attempts = 0;

        function attempt() {
            console.log(`Попытка ${attempts + 1} для запроса: ${query.substring(0, 50)}...`);
            db.run(query, params, function (err) {
                if (err) {
                    if (err.code === 'SQLITE_BUSY' && attempts < maxRetries) {
                        attempts++;
                        setTimeout(attempt, retryDelay * Math.pow(2, attempts));
                    } else {
                        console.error(`Ошибка после ${attempts + 1} попыток:`, err);
                        reject(err);
                    }
                } else {
                    resolve(this);
                }
            });
        }

        attempt();
    });
}

// Создать пользователя с хешированием пароля
function insertUser(name, email, password) {
    return new Promise((resolve, reject) => {
        bcrypt.hash(password, 10, (err, hashedPassword) => {
            if (err) return reject(err);
            enqueueQuery(
                'INSERT INTO users (name, email, password, phone, address, avatar, two_factor_enabled) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [name, email, hashedPassword, '', '', 'image/avatar.png', 0]
            )
                .then((stmt) => resolve(stmt.lastID))
                .catch(reject);
        });
    });
}

// Найти пользователя по email
function getUserByEmail(email) {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM users WHERE email = ?', [email], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

// Проверка пароля
function verifyPassword(email, password) {
    return new Promise((resolve, reject) => {
        db.get('SELECT password FROM users WHERE email = ?', [email], (err, row) => {
            if (err) return reject(err);
            if (!row) return resolve(false);
            bcrypt.compare(password, row.password, (err, result) => {
                if (err) return reject(err);
                resolve(result);
            });
        });
    });
}

// Обновление профиля пользователя
function updateUser(id, name, email, phone, address, avatar) {
    return new Promise((resolve, reject) => {
        enqueueQuery(
            'UPDATE users SET name = ?, email = ?, phone = ?, address = ?, avatar = ? WHERE id = ?',
            [name, email, phone, address, avatar || 'image/avatar.png', id]
        )
            .then(() => resolve())
            .catch(reject);
    });
}

// Смена пароля пользователя
function changeUserPassword(userId, newPassword) {
    return new Promise((resolve, reject) => {
        bcrypt.hash(newPassword, 10, (err, hashedPassword) => {
            if (err) return reject(err);
            enqueueQuery(
                'UPDATE users SET password = ? WHERE id = ?',
                [hashedPassword, userId]
            )
                .then(() => resolve())
                .catch(reject);
        });
    });
}

// Установка секрета 2FA
function setTwoFactorSecret(userId, secret) {
    return new Promise((resolve, reject) => {
        enqueueQuery(
            'UPDATE users SET two_factor_secret = ?, two_factor_enabled = 0 WHERE id = ?',
            [secret, userId]
        )
            .then(() => resolve())
            .catch(reject);
    });
}

// Включение/выключение 2FA
function setTwoFactorEnabled(userId, enabled) {
    return new Promise((resolve, reject) => {
        enqueueQuery(
            'UPDATE users SET two_factor_enabled = ? WHERE id = ?',
            [enabled ? 1 : 0, userId]
        )
            .then(() => resolve())
            .catch(reject);
    });
}

// Сохранение заказа
function saveOrder({ user_id, name, email, telegram, service, message, payment_status = 'pending', services = [] }) {
    return new Promise((resolve, reject) => {
        enqueueQuery(
            `INSERT INTO orders (user_id, name, email, telegram, service, message, status, payment_status, services, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            [user_id, name, email, telegram, service, message, 'processing', payment_status, JSON.stringify(services)]
        )
            .then((stmt) => resolve(stmt.lastID))
            .catch(reject);
    });
}

// Получение заказов пользователя
function getUserOrders(userId) {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT id, user_id, name, email, telegram, service, message, status, total_amount, payment_status, services, created_at
             FROM orders WHERE user_id = ?`,
            [userId],
            (err, rows) => {
                if (err) {
                    reject(err);
                    return;
                }
                try {
                    const orders = rows.map(row => ({
                        ...row,
                        services: row.services ? JSON.parse(row.services) : [],
                    }));
                    resolve(orders);
                } catch (parseErr) {
                    console.error('Ошибка при парсинге services:', parseErr, { row });
                    reject(new Error('Ошибка парсинга данных заказа'));
                }
            }
        );
    });
}

// Получение заказа по ID
function getOrderById(orderId, userId) {
    return new Promise((resolve, reject) => {
        db.get(
            `SELECT id, user_id, name, email, telegram, service, message, status, total_amount, payment_status, services, created_at
             FROM orders WHERE id = ? AND user_id = ?`,
            [orderId, userId],
            (err, row) => {
                if (err) {
                    reject(err);
                    return;
                }
                if (!row) {
                    resolve(null);
                    return;
                }
                try {
                    const order = {
                        ...row,
                        services: row.services ? JSON.parse(row.services) : [],
                    };
                    resolve(order);
                } catch (parseErr) {
                    console.error('Ошибка при парсинге services:', parseErr, { row });
                    reject(new Error('Ошибка парсинга данных заказа'));
                }
            }
        );
    });
}

// Обновление статуса заказа с использованием транзакции
function updateOrderStatus(orderId, status, paymentStatus = null) {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run('BEGIN IMMEDIATE TRANSACTION', (err) => {
                if (err) {
                    console.error('Ошибка при начале транзакции:', err);
                    reject(err);
                    return;
                }

                const params = [];
                let query = 'UPDATE orders SET ';
                const updates = [];

                if (status) {
                    updates.push('status = ?');
                    params.push(status);
                }
                if (paymentStatus) {
                    updates.push('payment_status = ?');
                    params.push(paymentStatus);
                }

                if (updates.length === 0) {
                    db.run('COMMIT', () => resolve(0));
                    return;
                }

                query += updates.join(', ') + ' WHERE id = ?';
                params.push(orderId);

                runWithRetry(query, params, 3, 500)
                    .then((stmt) => {
                        db.run('COMMIT', (err) => {
                            if (err) {
                                console.error('Ошибка при фиксации транзакции:', err);
                                reject(err);
                            } else {
                                resolve(stmt.changes);
                            }
                        });
                    })
                    .catch((err) => {
                        db.run('ROLLBACK', (rollbackErr) => {
                            console.error('Ошибка при откате транзакции:', rollbackErr || err);
                            reject(err);
                        });
                    });
            });
        });
    });
}

// Обновление цены заказа
function updateOrderPrice(orderId, total_amount) {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run('BEGIN IMMEDIATE TRANSACTION', (err) => {
                if (err) {
                    console.error('Ошибка при начале транзакции:', err);
                    reject(err);
                    return;
                }

                runWithRetry(
                    'UPDATE orders SET total_amount = ? WHERE id = ?',
                    [total_amount, orderId],
                    3,
                    500
                )
                    .then((stmt) => {
                        db.run('COMMIT', (err) => {
                            if (err) {
                                console.error('Ошибка при фиксации транзакции:', err);
                                reject(err);
                            } else {
                                resolve(stmt.changes);
                            }
                        });
                    })
                    .catch((err) => {
                        db.run('ROLLBACK', (rollbackErr) => {
                            console.error('Ошибка при откате транзакции:', rollbackErr || err);
                            reject(err);
                        });
                    });
            });
        });
    });
}

// Сохранение сообщения из формы контактов
function saveContactMessage({ name, email, telegram, message }) {
    return new Promise((resolve, reject) => {
        enqueueQuery(
            'INSERT INTO contact_messages (name, email, telegram, message) VALUES (?, ?, ?, ?)',
            [name, email, telegram, message]
        )
            .then((stmt) => resolve(stmt.lastID))
            .catch(reject);
    });
}

// Сохранение отзыва
function saveReview(user_id, rating, comment) {
    return new Promise((resolve, reject) => {
        enqueueQuery(
            'INSERT INTO reviews (user_id, rating, comment) VALUES (?, ?, ?)',
            [user_id, rating, comment]
        )
            .then((stmt) => resolve(stmt.lastID))
            .catch(reject);
    });
}

// Удаление отзыва
function deleteReview(review_id, user_id) {
    return new Promise((resolve, reject) => {
        enqueueQuery(
            'DELETE FROM reviews WHERE id = ? AND user_id = ?',
            [review_id, user_id]
        )
            .then((stmt) => resolve(stmt.changes))
            .catch(reject);
    });
}

// Получение всех отзывов
function getReviews() {
    return new Promise((resolve, reject) => {
        db.all(
            `SELECT r.*, u.name, u.avatar 
             FROM reviews r 
             JOIN users u ON r.user_id = u.id 
             ORDER BY r.created_at DESC`,
            [],
            (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            }
        );
    });
}

module.exports = {
    insertUser,
    getUserByEmail,
    verifyPassword,
    updateUser,
    changeUserPassword,
    setTwoFactorSecret,
    setTwoFactorEnabled,
    saveOrder,
    getUserOrders,
    getOrderById,
    updateOrderStatus,
    updateOrderPrice,
    saveContactMessage,
    saveReview,
    deleteReview,
    getReviews
};