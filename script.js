// ===== ШИФРОВАНИЕ ЧАТА =====
class ChatEncryption {
    constructor() {
        this.key = null;
        this.algorithm = { name: 'AES-GCM', length: 256 };
    }
    
    async generateRoomKey() {
        try {
            this.key = await crypto.subtle.generateKey(
                this.algorithm,
                true,
                ['encrypt', 'decrypt']
            );
            console.log('🔑 Ключ шифрования сгенерирован');
        } catch (error) {
            console.error('Ошибка генерации ключа:', error);
        }
    }
    
    async encryptMessage(text) {
        if (!this.key) return text;
        
        try {
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const encoded = new TextEncoder().encode(text);
            
            const encrypted = await crypto.subtle.encrypt(
                { name: 'AES-GCM', iv: iv },
                this.key,
                encoded
            );
            
            return JSON.stringify({
                iv: Array.from(iv),
                data: Array.from(new Uint8Array(encrypted)),
                encrypted: true
            });
            
        } catch (error) {
            console.error('Ошибка шифрования:', error);
            return text;
        }
    }
    
    async decryptMessage(encryptedData) {
        if (!this.key) return encryptedData;
        
        try {
            const data = JSON.parse(encryptedData);
            if (!data.encrypted) return encryptedData;
            
            const iv = new Uint8Array(data.iv);
            const encrypted = new Uint8Array(data.data);
            
            const decrypted = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: iv },
                this.key,
                encrypted
            );
            
            return new TextDecoder().decode(decrypted);
            
        } catch (error) {
            console.error('Ошибка дешифрования:', error);
            return encryptedData;
        }
    }
    
    async exportKey() {
        if (!this.key) return null;
        try {
            const exported = await crypto.subtle.exportKey('raw', this.key);
            return Array.from(new Uint8Array(exported));
        } catch (error) {
            console.error('Ошибка экспорта ключа:', error);
            return null;
        }
    }
    
    async importKey(keyData) {
        try {
            const keyBuffer = new Uint8Array(keyData).buffer;
            this.key = await crypto.subtle.importKey(
                'raw',
                keyBuffer,
                this.algorithm,
                true,
                ['encrypt', 'decrypt']
            );
            console.log('🔑 Ключ шифрования импортирован');
        } catch (error) {
            console.error('Ошибка импорта ключа:', error);
        }
    }
}

// ===== ОСНОВНОЙ КЛАСС ПРИЛОЖЕНИЯ =====
class VideoCallApp {
    constructor() {
        this.rtcConfig = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
            ]
        };

        this.state = {
            ws: null,
            localStream: null,
            screenStream: null,
            peerConnections: new Map(),
            dataChannels: new Map(),
            remoteStreams: new Map(),
            roomId: null,
            userId: this.generateId(),
            userName: 'Участник',
            userRole: 'user',
            isConnected: false,
            isCallActive: false,
            isMicMuted: false,
            isCameraOff: false,
            isScreenSharing: false,
            participants: new Map(),
            hasCamera: false,
            hasMicrophone: false,
            availableCameras: [],
            availableMicrophones: [],
            chatMessages: []
        };

        this.elements = {};
        this.chatCrypto = new ChatEncryption();
        
        this.init();
    }

    // ===== ИНИЦИАЛИЗАЦИЯ =====
    async init() {
        try {
            await this.loadDOMElements();
            this.setupEventListeners();
            await this.loadMediaDevices();
            this.showRoomSelection();
            
            console.log('🚀 VideoCall App инициализирован');
        } catch (error) {
            console.error('Ошибка инициализации:', error);
            this.showNotification('Ошибка запуска приложения', 'error');
        }
    }

    async loadDOMElements() {
        this.elements = {
            // Экран выбора комнаты
            roomSelection: document.getElementById('roomSelection'),
            roomIdInput: document.getElementById('roomIdInput'),
            userNameInput: document.getElementById('userNameInput'),
            createRoomBtn: document.getElementById('createRoomBtn'),
            joinRoomBtn: document.getElementById('joinRoomBtn'),
            
            // Интерфейс звонка
            callInterface: document.getElementById('callInterface'),
            videoContainer: document.getElementById('videoContainer'),
            localVideo: document.getElementById('localVideo'),
            usersContainer: document.getElementById('usersContainer'),
            usersCount: document.getElementById('usersCount'),
            
            // Панель управления
            toggleMic: document.getElementById('toggleMic'),
            toggleCamera: document.getElementById('toggleCamera'),
            shareScreen: document.getElementById('shareScreen'),
            settingsBtn: document.getElementById('settingsBtn'),
            hangupBtn: document.getElementById('hangupBtn'),
            
            // Статус
            connectionStatus: document.getElementById('connectionStatus'),
            userCount: document.getElementById('userCount'),
            roomIdDisplay: document.getElementById('roomIdDisplay'),
            
            // ЧАТ
            chatContainer: document.getElementById('chatContainer'),
            chatMessages: document.getElementById('chatMessages'),
            chatInput: document.getElementById('chatInput'),
            sendMessageBtn: document.getElementById('sendMessageBtn'),
            toggleChatBtn: document.getElementById('toggleChatBtn'),
            
            // НАСТРОЙКИ
            settingsModal: document.getElementById('settingsModal'),
            cameraSelect: document.getElementById('cameraSelect'),
            micSelect: document.getElementById('micSelect'),
            closeSettings: document.getElementById('closeSettings')
        };

        this.elements.roomIdInput.value = `VC-${Date.now().toString(36).toUpperCase()}`;
    }

    // ===== ЗАГРУЗКА УСТРОЙСТВ ДЛЯ НАСТРОЕК =====
    async loadMediaDevices() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            
            this.state.availableCameras = devices.filter(d => d.kind === 'videoinput');
            this.state.availableMicrophones = devices.filter(d => d.kind === 'audioinput');
            
            this.state.hasCamera = this.state.availableCameras.length > 0;
            this.state.hasMicrophone = this.state.availableMicrophones.length > 0;
            
            console.log(`📹 Камеры: ${this.state.availableCameras.length}, 🎤 Микрофоны: ${this.state.availableMicrophones.length}`);
            
            this.populateDeviceSelectors();
            
        } catch (error) {
            console.error('Ошибка загрузки устройств:', error);
        }
    }

    populateDeviceSelectors() {
        this.elements.cameraSelect.innerHTML = '';
        this.elements.micSelect.innerHTML = '';

        this.state.availableCameras.forEach((camera, index) => {
            const option = document.createElement('option');
            option.value = camera.deviceId;
            option.textContent = camera.label || `Камера ${index + 1}`;
            this.elements.cameraSelect.appendChild(option);
        });

        this.state.availableMicrophones.forEach((mic, index) => {
            const option = document.createElement('option');
            option.value = mic.deviceId;
            option.textContent = mic.label || `Микрофон ${index + 1}`;
            this.elements.micSelect.appendChild(option);
        });

        if (this.state.availableCameras.length === 0) {
            const option = document.createElement('option');
            option.textContent = 'Камеры не найдены';
            option.disabled = true;
            this.elements.cameraSelect.appendChild(option);
        }

        if (this.state.availableMicrophones.length === 0) {
            const option = document.createElement('option');
            option.textContent = 'Микрофоны не найдены';
            option.disabled = true;
            this.elements.micSelect.appendChild(option);
        }
    }

    setupEventListeners() {
        this.elements.createRoomBtn.addEventListener('click', () => this.createRoom());
        this.elements.joinRoomBtn.addEventListener('click', () => this.joinRoom());
        
        this.elements.toggleMic.addEventListener('click', () => this.toggleMicrophone());
        this.elements.toggleCamera.addEventListener('click', () => this.toggleCamera());
        this.elements.shareScreen.addEventListener('click', () => this.toggleScreenShare());
        this.elements.settingsBtn.addEventListener('click', () => this.showSettings());
        this.elements.hangupBtn.addEventListener('click', () => this.leaveRoom());
        
        this.elements.sendMessageBtn.addEventListener('click', () => this.sendChatMessage());
        this.elements.chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendChatMessage();
        });
        this.elements.toggleChatBtn.addEventListener('click', () => this.toggleChat());
        
        this.elements.closeSettings.addEventListener('click', () => this.hideSettings());
        this.elements.cameraSelect.addEventListener('change', (e) => this.changeCamera(e.target.value));
        this.elements.micSelect.addEventListener('change', (e) => this.changeMicrophone(e.target.value));
        
        this.elements.settingsModal.addEventListener('click', (e) => {
            if (e.target === this.elements.settingsModal) this.hideSettings();
        });
        
        document.addEventListener('keydown', (e) => this.handleKeyPress(e));
        window.addEventListener('beforeunload', () => this.cleanup());
    }

    // ===== УПРАВЛЕНИЕ КОМНАТАМИ =====
    async createRoom() {
        await this.joinRoom(true);
    }

    async joinRoom(isCreator = false) {
        try {
            const roomId = this.elements.roomIdInput.value.trim();
            const userName = this.elements.userNameInput.value.trim() || 'Участник';
            
            if (!roomId) {
                this.showNotification('Введите ID комнаты', 'error');
                return;
            }
            
            this.state.roomId = roomId;
            this.state.userName = userName;
            this.state.userRole = isCreator ? 'owner' : 'user';
            
            await this.connectToSignalingServer();
            
        } catch (error) {
            console.error('Ошибка подключения к комнате:', error);
            this.showNotification('Ошибка подключения', 'error');
        }
    }

    // ===== WEBRTC И СЕТЕВОЕ ВЗАИМОДЕЙСТВИЕ =====
    connectToSignalingServer() {
        return new Promise((resolve, reject) => {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}`;
            
            this.state.ws = new WebSocket(wsUrl);
            
            this.state.ws.onopen = () => {
                console.log('✅ Подключение к серверу установлено');
                this.joinRoomOnServer();
                resolve();
            };
            
            this.state.ws.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    this.handleSignalingMessage(message);
                } catch (error) {
                    console.error('Ошибка парсинга сообщения:', error);
                }
            };
            
            this.state.ws.onclose = () => {
                console.log('❌ Соединение с сервером закрыто');
                this.handleDisconnect();
            };
            
            this.state.ws.onerror = (error) => {
                console.error('WebSocket ошибка:', error);
                reject(error);
            };
            
            setTimeout(() => {
                if (this.state.ws.readyState !== WebSocket.OPEN) {
                    reject(new Error('Таймаут подключения'));
                }
            }, 10000);
        });
    }

    joinRoomOnServer() {
        this.sendToServer({
            type: 'join-room',
            roomId: this.state.roomId,
            userId: this.state.userId,
            userName: this.state.userName
        });
    }

    handleSignalingMessage(message) {
        switch (message.type) {
            case 'join-success':
                this.handleJoinSuccess(message);
                break;
            case 'user-joined':
                this.handleUserJoined(message.user);
                break;
            case 'user-left':
                this.handleUserLeft(message.userId);
                break;
            case 'user-promoted':
                this.handleUserPromoted(message.userId, message.role);
                break;
            case 'user-demoted':
                this.handleUserDemoted(message.userId, message.role);
                break;
            case 'webrtc-signal':
                this.handleWebRTCSignal(message);
                break;
            case 'admin-action':
                this.handleAdminAction(message);
                break;
            case 'admin-command':
                this.handleAdminCommand(message);
                break;
            case 'chat-message':
                this.handleChatMessage(message);
                break;
            case 'encryption-key':
                this.handleEncryptionKey(message.keyData);
                break;
            case 'error':
                this.showNotification(message.message, 'error');
                break;
        }
    }

    async handleJoinSuccess(message) {
        this.state.userRole = message.yourRole;
        this.state.isConnected = true;
        
        await this.startLocalStream();
        this.showCallInterface();
        this.updateParticipantsList(message.users);
        
        message.users.forEach(user => {
            if (user.id !== this.state.userId) {
                this.createPeerConnection(user.id, true);
            }
        });
        
        if (this.state.userRole === 'owner') {
            await this.chatCrypto.generateRoomKey();
            const keyData = await this.chatCrypto.exportKey();
            this.sendToServer({
                type: 'encryption-key',
                keyData: keyData
            });
        }
        
        this.showNotification(`Подключено к комнате ${this.state.roomId}`, 'success');
        this.updateConnectionStatus('connected');
    }

    async handleEncryptionKey(keyData) {
        await this.chatCrypto.importKey(keyData);
        this.showNotification('🔒 Чат защищен шифрованием', 'success');
    }

    // ===== УПРАВЛЕНИЕ МЕДИА =====
    async startLocalStream() {
        try {
            console.log('🎥 Инициализация медиа...');
            
            if (this.state.hasCamera && this.state.hasMicrophone) {
                try {
                    this.state.localStream = await navigator.mediaDevices.getUserMedia({
                        video: {
                            width: { ideal: 1280 },
                            height: { ideal: 720 },
                            frameRate: { ideal: 30 }
                        },
                        audio: {
                            echoCancellation: true,
                            noiseSuppression: true,
                            autoGainControl: true
                        }
                    });
                    console.log('✅ Камера и микрофон активированы');
                    this.elements.localVideo.srcObject = this.state.localStream;
                    
                } catch (cameraError) {
                    console.log('❌ Камера не доступна:', cameraError);
                    this.state.hasCamera = false;
                    await this.startAudioOnly();
                }
            } else if (this.state.hasMicrophone) {
                await this.startAudioOnly();
            } else {
                this.showVideoPlaceholder('Нет доступных медиа-устройств');
            }
            
            this.updateMediaControls();
            this.showNotification('Готов к звонку!', 'success');
            
        } catch (error) {
            console.error('❌ Ошибка инициализации медиа:', error);
            this.showVideoPlaceholder('Ошибка доступа к медиа');
            this.showNotification('Проверьте доступ к микрофону', 'warning');
        }
    }

    async startAudioOnly() {
        try {
            this.state.localStream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true
                }
            });
            console.log('✅ Аудио активировано');
            this.showVideoPlaceholder('Аудио режим');
            
        } catch (audioError) {
            console.log('❌ Микрофон не доступен:', audioError);
            this.state.hasMicrophone = false;
            this.showVideoPlaceholder('Только просмотр');
        }
    }

    showVideoPlaceholder(message = 'Видео не доступно') {
        this.elements.localVideo.style.background = '#2D3748';
        this.elements.localVideo.style.display = 'flex';
        this.elements.localVideo.style.alignItems = 'center';
        this.elements.localVideo.style.justifyContent = 'center';
        this.elements.localVideo.style.color = 'white';
        this.elements.localVideo.style.fontSize = '18px';
        this.elements.localVideo.innerHTML = `
            <div style="text-align: center;">
                <div style="font-size: 48px;">🎥</div>
                <div>${message}</div>
                <div style="font-size: 12px; margin-top: 10px; opacity: 0.7;">
                    Демонстрация экрана доступна
                </div>
            </div>
        `;
    }

    updateMediaControls() {
        this.elements.toggleMic.disabled = !this.state.hasMicrophone;
        this.elements.toggleCamera.disabled = !this.state.hasCamera;
        
        this.elements.toggleMic.classList.toggle('active', this.state.hasMicrophone && !this.state.isMicMuted);
        this.elements.toggleCamera.classList.toggle('active', this.state.hasCamera && !this.state.isCameraOff);
        
        if (!this.state.hasCamera) {
            this.elements.toggleCamera.innerHTML = '🚫';
            this.elements.toggleCamera.title = 'Камера не доступна';
        }
        
        if (!this.state.hasMicrophone) {
            this.elements.toggleMic.innerHTML = '🚫';
            this.elements.toggleMic.title = 'Микрофон не доступен';
        }
    }

    async toggleMicrophone() {
        if (!this.state.localStream || !this.state.hasMicrophone) return;
        
        const audioTracks = this.state.localStream.getAudioTracks();
        audioTracks.forEach(track => {
            track.enabled = !track.enabled;
        });
        
        this.state.isMicMuted = !this.state.isMicMuted;
        this.elements.toggleMic.classList.toggle('active', !this.state.isMicMuted);
        
        this.showNotification(
            this.state.isMicMuted ? 'Микрофон выключен' : 'Микрофон включен',
            this.state.isMicMuted ? 'warning' : 'success'
        );
    }

    async toggleCamera() {
        if (!this.state.localStream || !this.state.hasCamera) return;
        
        const videoTracks = this.state.localStream.getVideoTracks();
        videoTracks.forEach(track => {
            track.enabled = !track.enabled;
        });
        
        this.state.isCameraOff = !this.state.isCameraOff;
        this.elements.toggleCamera.classList.toggle('active', !this.state.isCameraOff);
        
        this.showNotification(
            this.state.isCameraOff ? 'Камера выключена' : 'Камера включена',
            this.state.isCameraOff ? 'warning' : 'success'
        );
    }

    // ===== ДЕМОНСТРАЦИЯ ЭКРАНА =====
    async toggleScreenShare() {
        if (this.state.isScreenSharing) {
            await this.stopScreenShare();
        } else {
            await this.startScreenShare();
        }
    }

    async startScreenShare() {
        try {
            console.log('🖥️ Запуск демонстрации экрана...');
            
            this.state.screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: {
                    cursor: 'always',
                    displaySurface: 'browser'
                },
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    sampleRate: 44100
                }
            });
            
            console.log('✅ Демонстрация экрана запущена');
            
            if (this.state.localStream) {
                const videoTrack = this.state.screenStream.getVideoTracks()[0];
                const localVideoTrack = this.state.localStream.getVideoTracks()[0];
                
                if (localVideoTrack) {
                    this.state.localStream.removeTrack(localVideoTrack);
                }
                this.state.localStream.addTrack(videoTrack);
                this.elements.localVideo.srcObject = this.state.localStream;
            } else {
                this.elements.localVideo.srcObject = this.state.screenStream;
                this.elements.localVideo.style.background = 'none';
            }
            
            this.state.isScreenSharing = true;
            this.elements.shareScreen.classList.add('active');
            
            this.updateVideoTracks();
            
            this.state.screenStream.getVideoTracks()[0].onended = () => {
                this.stopScreenShare();
            };
            
            this.showNotification('Демонстрация экрана начата', 'success');
            
        } catch (error) {
            console.error('❌ Ошибка демонстрации экрана:', error);
            if (error.name !== 'NotAllowedError') {
                this.showNotification('Ошибка демонстрации экрана', 'error');
            }
        }
    }

    async stopScreenShare() {
        if (!this.state.screenStream) return;
        
        try {
            console.log('🖥️ Остановка демонстрации экрана...');
            
            this.state.screenStream.getTracks().forEach(track => track.stop());
            this.state.screenStream = null;
            this.state.isScreenSharing = false;
            this.elements.shareScreen.classList.remove('active');
            
            if (this.state.hasCamera && this.state.localStream) {
                try {
                    const cameraStream = await navigator.mediaDevices.getUserMedia({
                        video: {
                            width: { ideal: 1280 },
                            height: { ideal: 720 }
                        }
                    });
                    const cameraTrack = cameraStream.getVideoTracks()[0];
                    
                    const screenTrack = this.state.localStream.getVideoTracks()[0];
                    if (screenTrack) {
                        this.state.localStream.removeTrack(screenTrack);
                    }
                    this.state.localStream.addTrack(cameraTrack);
                    this.elements.localVideo.srcObject = this.state.localStream;
                    
                    cameraStream.getTracks().forEach(track => {
                        if (track !== cameraTrack) track.stop();
                    });
                    
                } catch (cameraError) {
                    console.log('❌ Не удалось восстановить камеру:', cameraError);
                    this.showVideoPlaceholder('Камера не доступна');
                }
            } else {
                this.showVideoPlaceholder('Демонстрация завершена');
            }
            
            this.updateVideoTracks();
            this.showNotification('Демонстрация экрана остановлена', 'warning');
            
        } catch (error) {
            console.error('❌ Ошибка остановки демонстрации:', error);
        }
    }

    // ===== НАСТРОЙКИ УСТРОЙСТВ =====
    showSettings() {
        this.elements.settingsModal.classList.remove('hidden');
    }

    hideSettings() {
        this.elements.settingsModal.classList.add('hidden');
    }

    async changeCamera(deviceId) {
        if (!deviceId) return;
        
        try {
            if (this.state.localStream) {
                const videoTracks = this.state.localStream.getVideoTracks();
                videoTracks.forEach(track => track.stop());
                
                const newStream = await navigator.mediaDevices.getUserMedia({
                    video: { deviceId: { exact: deviceId } },
                    audio: this.state.localStream.getAudioTracks().length > 0
                });
                
                const newVideoTrack = newStream.getVideoTracks()[0];
                const oldVideoTrack = this.state.localStream.getVideoTracks()[0];
                
                if (oldVideoTrack) {
                    this.state.localStream.removeTrack(oldVideoTrack);
                }
                this.state.localStream.addTrack(newVideoTrack);
                
                this.elements.localVideo.srcObject = this.state.localStream;
                this.showNotification('Камера изменена', 'success');
            }
        } catch (error) {
            console.error('Ошибка смены камеры:', error);
            this.showNotification('Ошибка смены камеры', 'error');
        }
    }

    async changeMicrophone(deviceId) {
        if (!deviceId) return;
        
        try {
            if (this.state.localStream) {
                const audioTracks = this.state.localStream.getAudioTracks();
                audioTracks.forEach(track => track.stop());
                
                const newStream = await navigator.mediaDevices.getUserMedia({
                    video: this.state.localStream.getVideoTracks().length > 0,
                    audio: { deviceId: { exact: deviceId } }
                });
                
                const newAudioTrack = newStream.getAudioTracks()[0];
                const oldAudioTrack = this.state.localStream.getAudioTracks()[0];
                
                if (oldAudioTrack) {
                    this.state.localStream.removeTrack(oldAudioTrack);
                }
                this.state.localStream.addTrack(newAudioTrack);
                
                this.showNotification('Микрофон изменен', 'success');
            }
        } catch (error) {
            console.error('Ошибка смены микрофона:', error);
            this.showNotification('Ошибка смены микрофона', 'error');
        }
    }

    // ===== ЧАТ =====
    async sendChatMessage() {
        const messageText = this.elements.chatInput.value.trim();
        if (!messageText) return;

        try {
            const encryptedMessage = await this.chatCrypto.encryptMessage(messageText);
            const encryptedSender = await this.chatCrypto.encryptMessage(this.state.userName);
            
            this.sendToServer({
                type: 'chat-message',
                message: encryptedMessage,
                sender: encryptedSender,
                timestamp: Date.now(),
                userId: this.state.userId
            });

            this.elements.chatInput.value = '';
            
        } catch (error) {
            console.error('Ошибка отправки сообщения:', error);
        }
    }

    async handleChatMessage(message) {
        try {
            const decryptedMessage = await this.chatCrypto.decryptMessage(message.message);
            const decryptedSender = await this.chatCrypto.decryptMessage(message.sender);
            
            this.state.chatMessages.push({
                sender: decryptedSender,
                message: decryptedMessage,
                timestamp: message.timestamp,
                userId: message.userId
            });
            
            this.displayChatMessage(decryptedSender, decryptedMessage, message.timestamp, message.userId);
            
        } catch (error) {
            console.error('Ошибка обработки сообщения:', error);
        }
    }

    displayChatMessage(sender, message, timestamp, userId) {
        const messageElement = document.createElement('div');
        messageElement.className = `chat-message ${userId === this.state.userId ? 'own-message' : 'other-message'}`;
        
        const time = new Date(timestamp).toLocaleTimeString();
        
        messageElement.innerHTML = `
            <div class="message-sender">${sender} ${userId === this.state.userId ? '(Вы)' : ''}</div>
            <div class="message-text">${this.escapeHtml(message)}</div>
            <div class="message-time">${time}</div>
        `;
        
        this.elements.chatMessages.appendChild(messageElement);
        this.elements.chatMessages.scrollTop = this.elements.chatMessages.scrollHeight;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    toggleChat() {
        this.elements.chatContainer.classList.toggle('hidden');
    }

    // ===== АДМИН-ФУНКЦИИ =====
    renderUserActions(user) {
        if (user.id === this.state.userId) return '';
        
        const canManage = this.state.userRole === 'owner' || this.state.userRole === 'admin';
        if (!canManage) return '';
        
        return `
            <div class="user-actions">
                <button class="user-action-btn mute-btn" onclick="app.forceMuteUser('${user.id}')" title="Выключить микрофон">🔇</button>
                <button class="user-action-btn camera-btn" onclick="app.forceDisableCamera('${user.id}')" title="Выключить камеру">📷</button>
                ${this.state.userRole === 'owner' ? 
                    `<button class="user-action-btn admin-btn" onclick="app.toggleAdmin('${user.id}')" title="${user.role === 'admin' ? 'Снять админа' : 'Назначить админом'}">⭐</button>` : 
                    ''
                }
                <button class="user-action-btn kick-btn" onclick="app.kickUser('${user.id}')" title="Исключить">🚪</button>
            </div>
        `;
    }

    forceMuteUser(userId) {
        this.sendToServer({
            type: 'admin-command',
            command: 'mute-user',
            targetUserId: userId,
            fromUserId: this.state.userId
        });
        this.showNotification('Микрофон пользователя выключен', 'warning');
    }

    forceDisableCamera(userId) {
        this.sendToServer({
            type: 'admin-command',
            command: 'disable-camera',
            targetUserId: userId,
            fromUserId: this.state.userId
        });
        this.showNotification('Камера пользователя выключена', 'warning');
    }

    toggleAdmin(userId) {
        const user = this.state.participants.get(userId);
        const command = user.role === 'admin' ? 'demote-admin' : 'promote-to-admin';
        
        this.sendToServer({
            type: 'admin-command',
            command: command,
            targetUserId: userId,
            fromUserId: this.state.userId
        });
    }

    kickUser(userId) {
        if (confirm('Вы уверены, что хотите исключить этого пользователя?')) {
            this.sendToServer({
                type: 'admin-command',
                command: 'kick-user',
                targetUserId: userId,
                fromUserId: this.state.userId
            });
        }
    }

    handleAdminAction(message) {
        switch (message.action) {
            case 'mute-user':
                if (this.state.localStream) {
                    const audioTracks = this.state.localStream.getAudioTracks();
                    audioTracks.forEach(track => {
                        track.enabled = false;
                    });
                    this.state.isMicMuted = true;
                    this.elements.toggleMic.classList.remove('active');
                    this.showNotification('Администратор выключил ваш микрофон', 'warning');
                }
                break;
                
            case 'disable-camera':
                if (this.state.localStream) {
                    const videoTracks = this.state.localStream.getVideoTracks();
                    videoTracks.forEach(track => {
                        track.enabled = false;
                    });
                    this.state.isCameraOff = true;
                    this.elements.toggleCamera.classList.remove('active');
                    this.showNotification('Администратор выключил вашу камеру', 'warning');
                }
                break;
        }
    }

    handleAdminCommand(message) {
        this.sendDataChannelMessage(message.targetUserId, {
            type: 'admin-command',
            action: message.command,
            fromUserId: message.fromUserId
        });
    }

    // ===== WEBRTC СОЕДИНЕНИЯ =====
    async createPeerConnection(userId, isInitiator = false) {
        if (this.state.peerConnections.has(userId)) return;
        
        try {
            const pc = new RTCPeerConnection(this.rtcConfig);
            
            if (this.state.localStream) {
                this.state.localStream.getTracks().forEach(track => {
                    pc.addTrack(track, this.state.localStream);
                });
            }
            
            pc.ontrack = (event) => {
                this.handleRemoteTrack(userId, event.streams[0]);
            };
            
            pc.onicecandidate = (event) => {
                if (event.candidate) {
                    this.sendToServer({
                        type: 'webrtc-signal',
                        targetUserId: userId,
                        signal: {
                            type: 'ice-candidate',
                            candidate: event.candidate
                        }
                    });
                }
            };
            
            if (isInitiator) {
                const dataChannel = pc.createDataChannel('chat', {
                    ordered: true
                });
                this.setupDataChannel(userId, dataChannel);
            } else {
                pc.ondatachannel = (event) => {
                    this.setupDataChannel(userId, event.channel);
                };
            }
            
            this.state.peerConnections.set(userId, pc);
            
            if (isInitiator) {
                await this.createOffer(userId);
            }
            
        } catch (error) {
            console.error('Ошибка создания PeerConnection:', error);
        }
    }

    setupDataChannel(userId, dataChannel) {
        dataChannel.onopen = () => {
            console.log(`💬 Data channel открыт с ${userId}`);
            this.state.dataChannels.set(userId, dataChannel);
        };

        dataChannel.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                this.handleDataChannelMessage(userId, message);
            } catch (error) {
                console.error('Ошибка обработки сообщения data channel:', error);
            }
        };

        dataChannel.onclose = () => {
            console.log(`💬 Data channel закрыт с ${userId}`);
            this.state.dataChannels.delete(userId);
        };
    }

    handleDataChannelMessage(userId, message) {
        switch (message.type) {
            case 'chat-message':
                this.handleChatMessage(message);
                break;
            case 'admin-command':
                this.handleAdminAction(message);
                break;
        }
    }

    sendDataChannelMessage(userId, message) {
        const dataChannel = this.state.dataChannels.get(userId);
        if (dataChannel && dataChannel.readyState === 'open') {
            dataChannel.send(JSON.stringify(message));
        }
    }

    async createOffer(userId) {
        const pc = this.state.peerConnections.get(userId);
        if (!pc) return;
        
        try {
            const offer = await pc.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true
            });
            
            await pc.setLocalDescription(offer);
            
            this.sendToServer({
                type: 'webrtc-signal',
                targetUserId: userId,
                signal: {
                    type: 'offer',
                    offer: offer
                }
            });
            
        } catch (error) {
            console.error('Ошибка создания offer:', error);
        }
    }

    async handleWebRTCSignal(message) {
        const { senderUserId, signal } = message;
        
        try {
            switch (signal.type) {
                case 'offer':
                    await this.handleOffer(senderUserId, signal.offer);
                    break;
                case 'answer':
                    await this.handleAnswer(senderUserId, signal.answer);
                    break;
                case 'ice-candidate':
                    await this.handleIceCandidate(senderUserId, signal.candidate);
                    break;
            }
        } catch (error) {
            console.error('Ошибка обработки WebRTC сигнала:', error);
        }
    }

    async handleOffer(userId, offer) {
        const pc = await this.createPeerConnection(userId, false);
        await pc.setRemoteDescription(offer);
        
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        this.sendToServer({
            type: 'webrtc-signal',
            targetUserId: userId,
            signal: {
                type: 'answer',
                answer: answer
            }
        });
    }

    async handleAnswer(userId, answer) {
        const pc = this.state.peerConnections.get(userId);
        if (pc) {
            await pc.setRemoteDescription(answer);
        }
    }

    async handleIceCandidate(userId, candidate) {
        const pc = this.state.peerConnections.get(userId);
        if (pc && candidate) {
            await pc.addIceCandidate(candidate);
        }
    }

    // ===== ИНТЕРФЕЙС И ОТОБРАЖЕНИЕ =====
    showRoomSelection() {
        this.elements.roomSelection.classList.remove('hidden');
        this.elements.callInterface.classList.add('hidden');
        this.updateConnectionStatus('disconnected');
    }

    showCallInterface() {
        this.elements.roomSelection.classList.add('hidden');
        this.elements.callInterface.classList.remove('hidden');
        this.updateUI();
    }

    updateUI() {
        this.elements.roomIdDisplay.textContent = `Комната: ${this.state.roomId}`;
        this.elements.userCount.textContent = `Участники: ${this.state.participants.size}/10`;
    }

    updateParticipantsList(users) {
        this.state.participants.clear();
        this.elements.usersContainer.innerHTML = '';
        
        users.forEach(user => {
            this.addParticipant(user);
        });
        
        this.updateUsersCount();
    }

    addParticipant(user) {
        if (!this.state.participants.has(user.id)) {
            this.state.participants.set(user.id, user);
            this.renderParticipant(user);
            this.updateUsersCount();
        }
    }

    renderParticipant(user) {
        const userElement = document.createElement('div');
        userElement.className = 'user-item';
        userElement.id = `user-${user.id}`;
        
        const isYou = user.id === this.state.userId;
        const badge = this.getUserBadgeHTML(user.role);
        
        userElement.innerHTML = `
            <div class="user-avatar">${user.name.charAt(0)}</div>
            <div class="user-info">
                <div class="user-name">
                    ${user.name} ${isYou ? '(Вы)' : ''}
                    ${badge}
                </div>
                <div class="user-status">
                    <span class="status-indicator mic">🎤</span>
                    <span class="status-indicator camera">📹</span>
                </div>
            </div>
            ${this.renderUserActions(user)}
        `;
        
        this.elements.usersContainer.appendChild(userElement);
    }

    getUserBadgeHTML(role) {
        switch (role) {
            case 'owner':
                return '<span class="user-badge owner">👑 ВЛАДЕЛЕЦ</span>';
            case 'admin':
                return '<span class="user-badge admin">⭐ АДМИН</span>';
            default:
                return '';
        }
    }

    // ===== СЕТЕВЫЕ ФУНКЦИИ =====
    sendToServer(message) {
        if (this.state.ws && this.state.ws.readyState === WebSocket.OPEN) {
            this.state.ws.send(JSON.stringify(message));
        }
    }

    updateConnectionStatus(status) {
        this.elements.connectionStatus.textContent = this.getStatusText(status);
        this.elements.connectionStatus.className = status;
    }

    getStatusText(status) {
        const statuses = {
            disconnected: '❌ Не подключено',
            connecting: '🔄 Подключение...', 
            connected: '✅ Подключено'
        };
        return statuses[status] || 'Неизвестно';
    }

    // ===== УВЕДОМЛЕНИЯ =====
    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.innerHTML = `
            <span>${message}</span>
            <button onclick="this.parentElement.remove()">×</button>
        `;
        
        Object.assign(notification.style, {
            position: 'fixed',
            top: '20px',
            right: '20px',
            background: this.getNotificationColor(type),
            color: 'white',
            padding: '12px 16px',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            zIndex: '10000',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            maxWidth: '300px',
            animation: 'slideIn 0.3s ease-out'
        });
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            if (notification.parentElement) {
                notification.remove();
            }
        }, 4000);
    }

    getNotificationColor(type) {
        const colors = {
            success: '#10B981',
            error: '#EF4444', 
            warning: '#F59E0B',
            info: '#6366F1'
        };
        return colors[type] || colors.info;
    }

    // ===== ОБРАБОТЧИКИ СОБЫТИЙ =====
    handleKeyPress(event) {
        if (event.code === 'Space' && event.ctrlKey) {
            event.preventDefault();
            this.toggleMicrophone();
        } else if (event.code === 'KeyV' && event.ctrlKey) {
            event.preventDefault();
            this.toggleCamera();
        } else if (event.code === 'Escape') {
            if (this.state.isScreenSharing) {
                this.stopScreenShare();
            }
        }
    }

    // ===== ОБРАБОТКА ПОЛЬЗОВАТЕЛЕЙ =====
    handleUserJoined(user) {
        this.addParticipant(user);
        this.showNotification(`${user.name} присоединился`, 'info');
    }

    handleUserLeft(userId) {
        const user = this.state.participants.get(userId);
        if (user) {
            this.showNotification(`${user.name} покинул звонок`, 'warning');
            this.state.participants.delete(userId);
            this.updateParticipantsList(Array.from(this.state.participants.values()));
        }
    }

    handleUserPromoted(userId, role) {
        const user = this.state.participants.get(userId);
        if (user) {
            user.role = role;
            this.updateParticipantsList(Array.from(this.state.participants.values()));
            this.showNotification(`${user.name} теперь администратор`, 'info');
        }
    }

    handleUserDemoted(userId, role) {
        const user = this.state.participants.get(userId);
        if (user) {
            user.role = role;
            this.updateParticipantsList(Array.from(this.state.participants.values()));
            this.showNotification(`${user.name} больше не администратор`, 'info');
        }
    }

    handleRemoteTrack(userId, stream) {
        console.log(`📹 Получен удаленный поток от ${userId}`);
        this.state.remoteStreams.set(userId, stream);
        
        // Создаем видео элемент для удаленного пользователя
        const remoteVideo = document.createElement('video');
        remoteVideo.id = `remote-video-${userId}`;
        remoteVideo.srcObject = stream;
        remoteVideo.autoplay = true;
        remoteVideo.playsInline = true;
        remoteVideo.className = 'remote-video';
        
        const videoWrapper = document.createElement('div');
        videoWrapper.className = 'video-wrapper';
        videoWrapper.appendChild(remoteVideo);
        
        const user = this.state.participants.get(userId);
        if (user) {
            const label = document.createElement('div');
            label.className = 'video-label';
            label.textContent = user.name;
            videoWrapper.appendChild(label);
        }
        
        this.elements.videoContainer.appendChild(videoWrapper);
    }

    handleDisconnect() {
        this.showNotification('Соединение с сервером потеряно', 'error');
        this.showRoomSelection();
    }

    leaveRoom() {
        this.cleanup();
        this.showRoomSelection();
        this.showNotification('Звонок завершен', 'info');
    }

    updateUsersCount() {
        this.elements.usersCount.textContent = `(${this.state.participants.size})`;
    }

    // ===== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====
    generateId() {
        return Math.random().toString(36).substr(2, 9);
    }

    updateAudioTracks() {
        // Обновление аудио треков во всех соединениях
        this.state.peerConnections.forEach((pc, userId) => {
            const senders = pc.getSenders();
            senders.forEach(sender => {
                if (sender.track && sender.track.kind === 'audio') {
                    const audioTracks = this.state.localStream.getAudioTracks();
                    if (audioTracks[0]) {
                        sender.replaceTrack(audioTracks[0]);
                    }
                }
            });
        });
    }

    updateVideoTracks() {
        // Обновление видео треков во всех соединениях
        this.state.peerConnections.forEach((pc, userId) => {
            const senders = pc.getSenders();
            senders.forEach(sender => {
                if (sender.track && sender.track.kind === 'video') {
                    const videoTracks = this.state.localStream.getVideoTracks();
                    if (videoTracks[0]) {
                        sender.replaceTrack(videoTracks[0]);
                    }
                }
            });
        });
    }

    // ===== ОЧИСТКА =====
    cleanup() {
        this.state.peerConnections.forEach(pc => pc.close());
        this.state.dataChannels.forEach(dc => dc.close());
        
        if (this.state.localStream) {
            this.state.localStream.getTracks().forEach(track => track.stop());
        }
        if (this.state.screenStream) {
            this.state.screenStream.getTracks().forEach(track => track.stop());
        }
        
        if (this.state.ws) {
            this.state.ws.close();
        }
    }
}

// ===== ИНИЦИАЛИЗАЦИЯ ПРИЛОЖЕНИЯ =====
let app;

document.addEventListener('DOMContentLoaded', () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Ваш браузер не поддерживает WebRTC. Пожалуйста, используйте современный браузер.');
        return;
    }

    app = new VideoCallApp();
    window.app = app;
});

// Стили для уведомлений
const notificationStyles = document.createElement('style');
notificationStyles.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    
    .notification button {
        background: none;
        border: none;
        color: white;
        font-size: 18px;
        cursor: pointer;
        padding: 0;
        width: 20px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
    }
`;
document.head.appendChild(notificationStyles);