document.addEventListener('DOMContentLoaded', function() {
    // Mobile Navigation Toggle
    const hamburger = document.querySelector('.hamburger');
    const navMenu = document.querySelector('.nav-links');

    if (hamburger) {
        hamburger.addEventListener('click', function() {
            hamburger.classList.toggle('active');
            navMenu.classList.toggle('active');
        });
    }

    // Close mobile menu when clicking a nav link
    const navLinks = document.querySelectorAll('.nav-links a');
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            if (hamburger && hamburger.classList.contains('active')) {
                hamburger.classList.remove('active');
                navMenu.classList.remove('active');
            }
        });
    });

    // Dashboard Tabs
    const menuLinks = document.querySelectorAll('.dashboard-menu a');
    const sections = document.querySelectorAll('.dashboard-content > div');

    menuLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = link.getAttribute('href').substring(1);

            menuLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');

            sections.forEach(section => {
                section.style.display = section.id === targetId ? 'block' : 'none';
            });

            if (targetId === 'orders') {
                loadOrders();
            }
        });
    });

    // Load Profile Data
    if (window.location.pathname.includes('dashboard.html')) {
        fetch('/profile')
            .then(response => {
                if (response.status === 401) {
                    window.location.href = '/login.html';
                    return;
                }
                return response.json();
            })
            .then(data => {
                if (data) {
                    document.querySelector('.user-name').textContent = data.name || '';
                    document.querySelector('.user-email').textContent = data.email || '';
                    document.getElementById('profileName').value = data.name || '';
                    document.getElementById('profileEmail').value = data.email || '';
                    document.getElementById('profilePhone').value = data.phone || '';
                    document.getElementById('profileAddress').value = data.address || '';
                    document.querySelector('.user-avatar img').src = data.avatar || 'image/avatar.png';
                    document.querySelector('.profile-settings img').src = data.avatar || 'image/avatar.png';

                    // Устанавливаем переключатель 2FA
                    const twoFactorToggle = document.getElementById('twoFactorToggle');
                    if (twoFactorToggle) {
                        twoFactorToggle.checked = data.two_factor_enabled;
                    }
                }
            })
            .catch(err => {
                console.error('Ошибка при получении профиля:', err);
                window.location.href = '/login.html';
            });
    }

    // 2FA Handling
    const twoFactorToggle = document.getElementById('twoFactorToggle');
    if (twoFactorToggle) {
        twoFactorToggle.addEventListener('change', async () => {
            if (twoFactorToggle.checked) {
                try {
                    const response = await fetch('/api/2fa/setup');
                    const result = await response.json();
                    if (response.ok) {
                        document.getElementById('twoFactorQR').src = result.qrCode;
                        showModal('twoFactorModal');
                    } else {
                        alert(`Ошибка: ${result.error}`);
                        twoFactorToggle.checked = false;
                    }
                } catch (err) {
                    console.error('Ошибка при настройке 2FA:', err);
                    alert('Ошибка при настройке 2FA');
                    twoFactorToggle.checked = false;
                }
            } else {
                if (confirm('Вы уверены, что хотите отключить двухфакторную аутентификацию?')) {
                    try {
                        const response = await fetch('/api/2fa/disable', { method: 'POST' });
                        const result = await response.json();
                        if (response.ok) {
                            alert(result.message);
                        } else {
                            alert(`Ошибка: ${result.error}`);
                            twoFactorToggle.checked = true;
                        }
                    } catch (err) {
                        console.error('Ошибка при отключении 2FA:', err);
                        alert('Ошибка при отключении 2FA');
                        twoFactorToggle.checked = true;
                    }
                } else {
                    twoFactorToggle.checked = true;
                }
            }
        });
    }

    const verifyTwoFactorBtn = document.getElementById('verifyTwoFactor');
    if (verifyTwoFactorBtn) {
        verifyTwoFactorBtn.addEventListener('click', async () => {
            const code = document.getElementById('twoFactorCode').value.trim();
            if (!code || code.length !== 6) {
                alert('Введите 6-значный код');
                return;
            }

            try {
                const response = await fetch('/api/2fa/verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code })
                });
                const result = await response.json();
                if (response.ok) {
                    alert(result.message);
                    hideModal('twoFactorModal');
                    document.getElementById('twoFactorCode').value = '';
                } else {
                    alert(`Ошибка: ${result.error}`);
                }
            } catch (err) {
                console.error('Ошибка при проверке 2FA:', err);
                alert('Ошибка при проверке 2FA');
            }
        });
    }

    const cancelTwoFactorBtn = document.getElementById('cancelTwoFactor');
    if (cancelTwoFactorBtn) {
        cancelTwoFactorBtn.addEventListener('click', () => {
            hideModal('twoFactorModal');
            document.getElementById('twoFactorToggle').checked = false;
            document.getElementById('twoFactorCode').value = '';
        });
    }

    const closeTwoFactorModal = document.getElementById('closeTwoFactorModal');
    if (closeTwoFactorModal) {
        closeTwoFactorModal.addEventListener('click', () => {
            hideModal('twoFactorModal');
            document.getElementById('twoFactorToggle').checked = false;
            document.getElementById('twoFactorCode').value = '';
        });
    }

    // 2FA Login Handling
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const email = document.getElementById('email').value.trim();
            const password = document.getElementById('password').value.trim();

            try {
                const response = await fetch('/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });

                const result = await response.json();
                if (response.ok) {
                    if (result.twoFactorRequired) {
                        showModal('twoFactorLoginModal');
                    } else {
                        window.location.href = result.redirect;
                    }
                } else {
                    alert(`Ошибка: ${result.message}`);
                }
            } catch (err) {
                console.error('Ошибка при входе:', err);
                alert('Ошибка при входе');
            }
        });
    }

    const verifyTwoFactorLoginBtn = document.getElementById('verifyTwoFactorLogin');
    if (verifyTwoFactorLoginBtn) {
        verifyTwoFactorLoginBtn.addEventListener('click', async () => {
            const code = document.getElementById('twoFactorLoginCode').value.trim();
            if (!code || code.length !== 6) {
                alert('Введите 6-значный код');
                return;
            }

            try {
                const response = await fetch('/api/2fa/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code })
                });
                const result = await response.json();
                if (response.ok) {
                    window.location.href = result.redirect;
                } else {
                    alert(`Ошибка: ${result.error}`);
                }
            } catch (err) {
                console.error('Ошибка при проверке 2FA:', err);
                alert('Ошибка при проверке 2FA');
            }
        });
    }

    const cancelTwoFactorLoginBtn = document.getElementById('cancelTwoFactorLogin');
    if (cancelTwoFactorLoginBtn) {
        cancelTwoFactorLoginBtn.addEventListener('click', () => {
            hideModal('twoFactorLoginModal');
            document.getElementById('twoFactorLoginCode').value = '';
        });
    }

    const closeTwoFactorLoginModal = document.getElementById('closeTwoFactorLoginModal');
    if (closeTwoFactorLoginModal) {
        closeTwoFactorLoginModal.addEventListener('click', () => {
            hideModal('twoFactorLoginModal');
            document.getElementById('twoFactorLoginCode').value = '';
        });
    }

    // Load Orders
    function loadOrders() {
        fetch('/api/orders')
            .then(response => {
                if (response.status === 401) {
                    window.location.href = '/login.html';
                    return;
                }
                return response.json();
            })
            .then(orders => {
                const currentOrders = document.getElementById('currentOrders');
                const completedOrders = document.getElementById('completedOrders');
                const cancelledOrders = document.getElementById('cancelledOrders');

                // Очистка контейнеров
                currentOrders.innerHTML = '';
                completedOrders.innerHTML = '';
                cancelledOrders.innerHTML = '';

                // Разделение заказов
                const current = orders.filter(order => order.status === 'processing');
                const completed = orders.filter(order => order.status === 'completed');
                const cancelled = orders.filter(order => order.status === 'cancelled');

                // Рендеринг текущих заказов
                if (current.length === 0) {
                    currentOrders.innerHTML = '<p>Нет текущих заказов.</p>';
                } else {
                    current.forEach(order => {
                        const orderItem = createOrderItem(order);
                        currentOrders.appendChild(orderItem);
                    });
                }

                // Рендеринг выполненных заказов
                if (completed.length === 0) {
                    completedOrders.innerHTML = '<p>Нет выполненных заказов.</p>';
                } else {
                    completed.forEach(order => {
                        const orderItem = createOrderItem(order);
                        completedOrders.appendChild(orderItem);
                    });
                }

                // Рендеринг отмененных заказов
                if (cancelled.length === 0) {
                    cancelledOrders.innerHTML = '<p>Нет отмененных заказов.</p>';
                } else {
                    cancelled.forEach(order => {
                        const orderItem = createOrderItem(order);
                        cancelledOrders.appendChild(orderItem);
                    });
                }
            })
            .catch(err => {
                console.error('Ошибка при загрузке заказов:', err);
                document.getElementById('currentOrders').innerHTML = '<p>Ошибка при загрузке заказов.</p>';
                document.getElementById('completedOrders').innerHTML = '<p>Ошибка при загрузке заказов.</p>';
                document.getElementById('cancelledOrders').innerHTML = '<p>Ошибка при загрузке заказов.</p>';
            });
    }

    // Создание элемента заказа
    function createOrderItem(order) {
        const orderItem = document.createElement('div');
        orderItem.className = 'order-item';
        const serviceNames = {
            'pc_repair': 'Ремонт компьютера',
            'laptop_repair': 'Ремонт ноутбука',
            'software': 'Установка ПО',
            'pc_assembly': 'Сборка ПК',
            'data_recovery': 'Восстановление данных',
            'network_setup': 'Настройка сети'
        };
        // Определяем статус для отображения
        let statusText, statusClass;
        switch(order.status) {
            case 'processing':
                statusText = 'В обработке';
                statusClass = 'status-processing';
                break;
            case 'completed':
                statusText = 'Завершен';
                statusClass = 'status-completed';
                break;
            case 'cancelled':
                statusText = 'Отменен';
                statusClass = 'status-cancelled';
                break;
            default:
                statusText = order.status;
                statusClass = 'status-processing';
        }
        orderItem.innerHTML = `
            <div class="order-header">
                <div class="order-id">Заказ #${order.id}</div>
                <div class="order-status ${statusClass}">${statusText}</div>
            </div>
            <div class="order-body">
                <div class="order-info">
                    <div class="order-info-item">
                        <p><span>Дата:</span> ${new Date(order.created_at).toLocaleDateString()}</p>
                    </div>
                    <div class="order-info-item">
                        <p><span>Сумма:</span> ${order.total_amount != null ? order.total_amount + ' руб.' : 'не указана'}</p>
                    </div>
                    <div class="order-info-item">
                        <p><span>Статус оплаты:</span> ${order.payment_status === 'pending' ? 'Ожидает оплаты' : 'Оплачено'}</p>
                    </div>
                </div>
                <div class="order-details">
                    <h4 style="margin-bottom: 10px;">Услуги</h4>
                    ${order.services.map(service => `
                        <div class="order-service">
                            <div>${serviceNames[service.name] || service.name}</div>
                            <div>${service.price != null ? service.price + ' руб.' : 'не указана'}</div>
                        </div>
                    `).join('')}
                    <div class="order-total">
                        <div>Итого:</div>
                        <div>${order.total_amount != null ? order.total_amount + ' руб.' : 'не указана'}</div>
                    </div>
                </div>
                ${order.status === 'processing' ? `
                    <div class="order-actions">
                        <button class="btn btn-danger cancel-order" data-order-id="${order.id}">Отменить заказ</button>
                        ${order.payment_status === 'pending' && order.total_amount != null ? `
                            <button class="btn btn-primary pay-order" data-order-id="${order.id}">Оплатить</button>
                        ` : ''}
                    </div>
                ` : ''}
            </div>
        `;
        // Добавляем обработчик для кнопки отмены заказа
        const cancelButton = orderItem.querySelector('.cancel-order');
        if (cancelButton) {
            cancelButton.addEventListener('click', async () => {
                if (confirm('Вы уверены, что хотите отменить заказ?')) {
                    try {
                        const response = await fetch(`/api/orders/cancel/${order.id}`, {
                            method: 'POST'
                        });
                        const result = await response.json();
                        if (response.ok) {
                            alert(result.message);
                            loadOrders(); // Перезагружаем заказы
                        } else {
                            alert(`Ошибка: ${result.error}`);
                        }
                    } catch (err) {
                        console.error('Ошибка при отмене заказа:', err);
                        alert('Ошибка при отмене заказа');
                    }
                }
            });
        }

        // Добавляем обработчик для кнопки оплаты
        const payButton = orderItem.querySelector('.pay-order');
        if (payButton) {
            payButton.addEventListener('click', async () => {
                try {
                    const response = await fetch(`/api/orders/${order.id}`);
                    const orderDetails = await response.json();
                    if (response.ok) {
                        const serviceNames = {
                            'pc_repair': 'Ремонт компьютера',
                            'laptop_repair': 'Ремонт ноутбука',
                            'software': 'Установка ПО',
                            'pc_assembly': 'Сборка ПК',
                            'data_recovery': 'Восстановление данных',
                            'network_setup': 'Настройка сети'
                        };
                        
                        document.getElementById('paymentServiceName').textContent = 
                            serviceNames[orderDetails.service] || orderDetails.service;
                        document.getElementById('paymentAmount').textContent = 
                            `${orderDetails.total_amount} руб.`;
                        document.getElementById('paymentForm').dataset.orderId = order.id;
                        showModal('paymentModal');
                    } else {
                        alert(`Ошибка: ${orderDetails.error}`);
                    }
                } catch (err) {
                    console.error('Ошибка при загрузке данных заказа:', err);
                    alert('Ошибка при загрузке данных заказа');
                }
            });
        }

        return orderItem;
    }

    // Функция для форматирования номера карты
    function formatCardNumber(input) {
        let value = input.value.replace(/\s+/g, '').replace(/[^0-9]/gi, '');
        let formatted = '';
        for (let i = 0; i < value.length; i++) {
            if (i > 0 && i % 4 === 0) formatted += ' ';
            formatted += value[i];
        }
        input.value = formatted.substring(0, 19);
    }

    // Функция для форматирования срока действия карты
    function formatExpiryDate(input) {
        let value = input.value.replace(/\s+/g, '').replace(/[^0-9]/gi, '');
        if (value.length > 2) {
            value = value.substring(0, 2) + '/' + value.substring(2, 4);
        }
        input.value = value.substring(0, 5);
    }

    // Обработка формы оплаты
    const paymentForm = document.getElementById('paymentForm');
    if (paymentForm) {
        let isPaymentProcessing = false; // Флаг для предотвращения повторных запросов

        paymentForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            if (isPaymentProcessing) {
                alert('Платеж уже обрабатывается. Пожалуйста, подождите.');
                return;
            }

            const cardNumber = document.getElementById('cardNumber').value.replace(/\s+/g, '');
            const cardHolder = document.getElementById('cardHolder').value.trim();
            const cardExpiry = document.getElementById('cardExpiry').value.trim();
            const cardCVC = document.getElementById('cardCVC').value.trim();
            const orderId = paymentForm.dataset.orderId;

            // Валидация полей
            if (!cardNumber.match(/^\d{16}$/)) {
                alert('Номер карты должен содержать 16 цифр');
                return;
            }
            
            if (!cardHolder.match(/^[A-Za-zА-Яа-яЁё\s]+$/)) {
                alert('Имя держателя карты должно содержать только буквы');
                return;
            }
            
            if (!cardExpiry.match(/^\d{2}\/\d{2}$/)) {
                alert('Срок действия должен быть в формате MM/ГГ');
                return;
            }
            
            const [month, year] = cardExpiry.split('/');
            const currentYear = new Date().getFullYear() % 100;
            const currentMonth = new Date().getMonth() + 1;
            if (parseInt(month) < 1 || parseInt(month) > 12) {
                alert('Некорректный месяц');
                return;
            }
            if (parseInt(year) < currentYear || (parseInt(year) === currentYear && parseInt(month) < currentMonth)) {
                alert('Карта истекла');
                return;
            }
            
            if (!cardCVC.match(/^\d{3}$/)) {
                alert('CVC должен содержать 3 цифры');
                return;
            }

            // Показываем индикатор загрузки
            const payButton = document.getElementById('confirmPayment');
            const originalText = payButton.innerHTML;
            payButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Обработка...';
            payButton.disabled = true;
            isPaymentProcessing = true;

            try {
                // Имитация быстрой обработки платежа (0.5 секунды)
                await new Promise(resolve => setTimeout(resolve, 500));
                
                const response = await fetch(`/api/orders/pay/${orderId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ cardNumber, cardHolder, cardExpiry, cardCVC })
                });
                
                const result = await response.json();
                if (response.ok) {
                    alert('Оплата успешно проведена!');
                    hideModal('paymentModal');
                    paymentForm.reset();
                    loadOrders(); // Перезагружаем список заказов для обновления статуса
                } else {
                    alert(`Ошибка: ${result.error}${result.details ? ' (' + result.details + ')' : ''}`);
                }
            } catch (err) {
                console.error('Ошибка при обработке оплаты:', err);
                alert('Ошибка при обработке оплаты. Попробуйте позже.');
            } finally {
                payButton.innerHTML = originalText;
                payButton.disabled = false;
                isPaymentProcessing = false;
            }
        });
    }

    // Закрытие модального окна оплаты
    const cancelPaymentBtn = document.getElementById('cancelPayment');
    if (cancelPaymentBtn) {
        cancelPaymentBtn.addEventListener('click', () => {
            hideModal('paymentModal');
            document.getElementById('paymentForm').reset();
        });
    }

    const closePaymentModal = document.getElementById('closePaymentModal');
    if (closePaymentModal) {
        closePaymentModal.addEventListener('click', () => {
            hideModal('paymentModal');
            document.getElementById('paymentForm').reset();
        });
    }

    // Profile Form Submission
    const profileForm = document.getElementById('profileForm');
    if (profileForm) {
        profileForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const name = document.getElementById('profileName').value.trim();
            const email = document.getElementById('profileEmail').value.trim();
            const phone = document.getElementById('profilePhone').value.trim();
            const address = document.getElementById('profileAddress').value.trim();
            const avatarInput = document.getElementById('profileImageInput');

            if (!name || !email) {
                alert('Имя и email обязательны для заполнения');
                return;
            }

            const formData = new FormData();
            formData.append('name', name);
            formData.append('email', email);
            formData.append('phone', phone);
            formData.append('address', address);
            if (avatarInput.files[0]) {
                formData.append('avatar', avatarInput.files[0]);
            }

            try {
                const response = await fetch('/profile', {
                    method: 'POST',
                    body: formData
                });

                const result = await response.json();
                if (response.ok) {
                    alert('Профиль успешно обновлен');
                    document.querySelector('.user-name').textContent = name;
                    document.querySelector('.user-email').textContent = email;
                    if (result.avatar) {
                        document.querySelector('.user-avatar img').src = result.avatar;
                        document.querySelector('.profile-settings img').src = result.avatar;
                    }
                } else {
                    alert(`Ошибка: ${result.error || 'Не удалось обновить профиль'}`);
                }
            } catch (err) {
                console.error('Ошибка при обновлении профиля:', err);
                alert('Ошибка при обновлении профиля. Попробуйте позже.');
            }
        });
    }

    // Registration Form Handling
    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const name = document.getElementById('name').value.trim();
            const email = document.getElementById('email').value.trim();
            const password = document.getElementById('password').value;
            const confirmPassword = document.getElementById('confirmPassword').value;

            if (password !== confirmPassword) {
                alert('Пароли не совпадают');
                return;
            }

            try {
                const response = await fetch('/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, email, password })
                });

                const result = await response.json();
                if (response.ok) {
                    window.location.href = result.redirect;
                } else {
                    alert(`Ошибка: ${result.message}`);
                }
            } catch (err) {
                console.error('Ошибка при регистрации:', err);
                alert('Ошибка при регистрации');
            }
        });
    }

    // Password Change Form
    const passwordChangeForm = document.getElementById('passwordChangeForm');
    if (passwordChangeForm) {
        passwordChangeForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const currentPassword = document.getElementById('currentPassword').value;
            const newPassword = document.getElementById('newPassword').value;
            const confirmNewPassword = document.getElementById('confirmNewPassword').value;

            if (!currentPassword || !newPassword || !confirmNewPassword) {
                alert('Пожалуйста, заполните все поля формы.');
                return;
            }

            if (newPassword !== confirmNewPassword) {
                alert('Новые пароли не совпадают.');
                return;
            }

            try {
                const response = await fetch('/api/change-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ currentPassword, newPassword, confirmNewPassword })
                });

                const result = await response.json();
                if (response.ok) {
                    alert(result.message);
                    passwordChangeForm.reset();
                } else {
                    alert(`Ошибка: ${result.error}`);
                }
            } catch (err) {
                console.error('Ошибка при смене пароля:', err);
                alert('Ошибка при смене пароля. Попробуйте позже.');
            }
        });
    }

    // Order Form Handling
    const orderForm = document.getElementById('order-form');
    if (orderForm) {
        orderForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const name = document.getElementById('name')?.value;
            const email = document.getElementById('email')?.value;
            const telegram = document.getElementById('telegram')?.value;
            const service = document.getElementById('service')?.value;
            const message = document.getElementById('message')?.value;

            if (!name || !email || !telegram || !service) {
                alert('Пожалуйста, заполните все обязательные поля.');
                return;
            }

            try {
                const response = await fetch('/api/orders', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    body: new URLSearchParams({
                        name,
                        email,
                        telegram,
                        service,
                        message,
                    }),
                });

                const result = await response.json();
                alert(result.message);
                orderForm.reset();
            } catch (err) {
                console.error('Ошибка при отправке:', err);
                alert('Ошибка при отправке. Попробуйте позже.');
            }
        });
    }

    // Contact Form Handling
    const contactForm = document.getElementById('contact-form');
    if (contactForm) {
        contactForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const name = contactForm.elements['name'].value.trim();
            const email = contactForm.elements['email'].value.trim();
            const telegram = contactForm.elements['telegram'].value.trim();
            const message = contactForm.elements['message'].value.trim();

            try {
                const response = await fetch('/api/contact', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ name, email, telegram, message }),
                });

                const result = await response.json();
                if (response.ok) {
                    alert('Сообщение отправлено успешно!');
                    contactForm.reset();
                } else {
                    alert(`Ошибка: ${result.error}`);
                }
            } catch (err) {
                console.error('Ошибка при отправке:', err);
                alert('Ошибка при отправке сообщения');
            }
        });
    }

    // Review Form Handling
    const reviewForm = document.getElementById('reviewForm');
    if (reviewForm) {
        reviewForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const reviewText = document.getElementById('reviewText').value.trim();
            const rating = document.querySelector('input[name="rating"]:checked')?.value;

            if (!reviewText || !rating) {
                alert('Пожалуйста, заполните текст отзыва и выберите оценку.');
                return;
            }

            try {
                const authCheck = await fetch('/profile');
                if (authCheck.status === 401) {
                    showModal('authModal');
                    return;
                }

                const response = await fetch('/api/reviews', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ rating: parseInt(rating), comment: reviewText })
                });

                const result = await response.json();
                if (response.ok) {
                    alert('Отзыв успешно отправлен!');
                    reviewForm.reset();
                    loadReviews(); // Перезагружаем отзывы
                } else {
                    alert(`Ошибка: ${result.error}`);
                }
            } catch (err) {
                console.error('Ошибка при отправке отзыва:', err);
                alert('Ошибка при отправке отзыва');
            }
        });
    }

    // Load Reviews
    function loadReviews() {
        fetch('/api/reviews')
            .then(response => response.json())
            .then(reviews => {
                const reviewList = document.getElementById('reviewList');
                reviewList.innerHTML = '';
                
                if (reviews.length === 0) {
                    reviewList.innerHTML = '<p style="text-align: center; color: #7f8c8d;">Отзывов пока нет.</p>';
                    return;
                }

                // Проверяем текущего пользователя
                fetch('/api/session')
                    .then(res => res.json())
                    .then(user => {
                        reviews.forEach(review => {
                            const isCurrentUserReview = user && user.id === review.user_id;
                            const reviewItem = document.createElement('div');
                            reviewItem.className = `review-item ${isCurrentUserReview ? 'user-review' : ''}`;
                            
                            reviewItem.innerHTML = `
                                <div class="review-header">
                                    <img src="${review.avatar || 'image/avatar.png'}" alt="Аватар" class="review-avatar">
                                    <div class="review-info">
                                        <h4>${review.name}</h4>
                                        <div class="rating">${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)}</div>
                                    </div>
                                    ${isCurrentUserReview ? 
                                        `<button class="delete-review" data-review-id="${review.id}">
                                            <i class="fas fa-trash-alt"></i>
                                        </button>` : ''}
                                </div>
                                <p class="review-comment">${review.comment}</p>
                                <p class="review-date">${new Date(review.created_at).toLocaleDateString('ru-RU', {
                                    year: 'numeric', 
                                    month: 'long', 
                                    day: 'numeric',
                                    hour: '2-digit',
                                    minute: '2-digit'
                                })}</p>
                            `;
                            
                            reviewList.appendChild(reviewItem);
                        });

                        // Добавляем обработчики для кнопок удаления
                        document.querySelectorAll('.delete-review').forEach(button => {
                            button.addEventListener('click', async (e) => {
                                e.preventDefault();
                                const reviewId = button.getAttribute('data-review-id');
                                
                                if (confirm('Вы уверены, что хотите удалить этот отзыв?')) {
                                    try {
                                        const response = await fetch(`/api/reviews/${reviewId}`, {
                                            method: 'DELETE'
                                        });
                                        
                                        if (response.ok) {
                                            loadReviews(); // Перезагружаем отзывы
                                        } else {
                                            const result = await response.json();
                                            alert(`Ошибка: ${result.error}`);
                                        }
                                    } catch (err) {
                                        console.error('Ошибка при удалении отзыва:', err);
                                        alert('Ошибка при удалении отзыва');
                                    }
                                }
                            });
                        });
                    });
            })
            .catch(err => {
                console.error('Ошибка при загрузке отзывов:', err);
                document.getElementById('reviewList').innerHTML = '<p style="text-align: center; color: #e74c3c;">Ошибка при загрузке отзывов.</p>';
            });
    }

    // Вызов загрузки отзывов, если на странице reviews.html
    if (window.location.pathname.includes('reviews.html')) {
        loadReviews();
    }

    // Logout Handling
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            showModal('logoutModal');
        });
    }

    const confirmLogout = document.getElementById('confirmLogout');
    if (confirmLogout) {
        confirmLogout.addEventListener('click', () => {
            fetch('/logout')
                .then(() => {
                    window.location.href = '/login.html';
                })
                .catch(err => {
                    console.error('Ошибка при выходе:', err);
                    alert('Ошибка при выходе');
                });
        });
    }

    const cancelLogout = document.getElementById('cancelLogout');
    if (cancelLogout) {
        cancelLogout.addEventListener('click', () => {
            hideModal('logoutModal');
        });
    }

    const closeLogoutModal = document.getElementById('closeLogoutModal');
    if (closeLogoutModal) {
        closeLogoutModal.addEventListener('click', () => {
            hideModal('logoutModal');
        });
    }

    // Modal Handling
    function showModal(id) {
        const modal = document.getElementById(id);
        if (modal) {
            modal.style.display = 'flex';
            setTimeout(() => modal.classList.add('active'), 10);
        }
    }

    function hideModal(id) {
        const modal = document.getElementById(id);
        if (modal) {
            modal.classList.remove('active');
            setTimeout(() => {
                modal.style.display = 'none';
            }, 300);
        }
    }
});
fetch('/api/session')
  .then(res => res.json())
  .then(user => {
    if (user && user.name) {
      document.getElementById('login-button').style.display = 'none';
      const avatar = document.getElementById('user-avatar');
      avatar.src = user.avatar || 'image/avatar.png';
      avatar.style.display = 'inline';
      avatar.onclick = () => window.location.href = '/dashboard.html';
    }
  });
  // Функция для загрузки и отображения отзывов
function loadReviews() {
    fetch('/api/reviews')
        .then(response => response.json())
        .then(reviews => {
            const reviewList = document.getElementById('reviewList');
            reviewList.innerHTML = '';
            
            if (reviews.length === 0) {
                reviewList.innerHTML = '<p>Отзывов пока нет.</p>';
            } else {
                reviews.forEach(review => {
                    const reviewItem = document.createElement('div');
                    reviewItem.className = 'review-card';
                    
                    // Создаем звездочки рейтинга
                    let stars = '';
                    for (let i = 1; i <= 5; i++) {
                        stars += i <= review.rating ? '★' : '☆';
                    }
                    
                    reviewItem.innerHTML = `
                        <div class="review-header">
                            <img src="${review.avatar || 'image/avatar.png'}" alt="Аватар" class="review-avatar">
                            <div class="review-info">
                                <h4>${review.name}</h4>
                                <div class="review-rating">${stars}</div>
                            </div>
                            <div class="review-date">${new Date(review.created_at).toLocaleString()}</div>
                        </div>
                        <div class="review-content">
                            <p>${review.comment}</p>
                        </div>
                    `;
                    
                    reviewList.appendChild(reviewItem);
                });
            }
        })
        .catch(err => {
            console.error('Ошибка при загрузке отзывов:', err);
            document.getElementById('reviewList').innerHTML = '<p>Ошибка при загрузке отзывов.</p>';
        });
}

// Загрузка отзывов при открытии страницы
if (window.location.pathname.includes('reviews.html')) {
    loadReviews();
}

// Обработка отправки отзыва
const reviewForm = document.getElementById('reviewForm');
if (reviewForm) {
    reviewForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const reviewText = document.getElementById('reviewText').value.trim();
        const rating = document.querySelector('input[name="rating"]:checked')?.value;
        
        if (!reviewText || !rating) {
            alert('Пожалуйста, заполните текст отзыва и выберите оценку.');
            return;
        }
        
        try {
            const response = await fetch('/api/reviews', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    rating: parseInt(rating), 
                    comment: reviewText 
                })
            });
            
            if (response.ok) {
                alert('Отзыв успешно отправлен!');
                reviewForm.reset();
                loadReviews(); // Перезагружаем отзывы
            } else {
                const result = await response.json();
                alert(`Ошибка: ${result.error}`);
            }
        } catch (err) {
            console.error('Ошибка при отправке отзыва:', err);
            alert('Ошибка при отправке отзыва');
        }
    });
}