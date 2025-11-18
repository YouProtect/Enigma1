const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Обслуживаем статические файлы
app.use(express.static(path.join(__dirname)));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Хранилище комнат
const rooms = new Map();
const users = new Map();

// Максимальное количество пользователей
const MAX_USERS_PER_ROOM = 10;

class Room {
    constructor(id, ownerId) {
        this.id = id;
        this.ownerId = ownerId;
        this.users = new Set(); // WebSocket соединения
        this.admins = new Set(); // ID администраторов
        this.userData = new Map(); // Данные пользователей
    }
    
    addUser(ws, userId, userName) {
        if (this.users.size >= MAX_USERS_PER_ROOM) {
            throw new Error('ROOM_FULL');
        }
        
        this.users.add(ws);
        this.userData.set(userId, {
            id: userId,
            name: userName,
            role: userId === this.ownerId ? 'owner' : 'user',
            ws: ws
        });
    }
    
    removeUser(userId) {
        const userInfo = this.userData.get(userId);
        if (userInfo) {
            this.users.delete(userInfo.ws);
            this.userData.delete(userId);
            this.admins.delete(userId);
        }
    }
    
    getUserRole(userId) {
        if (userId === this.ownerId) return 'owner';
        if (this.admins.has(userId)) return 'admin';
        return 'user';
    }
    
    promoteToAdmin(userId) {
        if (this.userData.has(userId) && userId !== this.ownerId) {
            this.admins.add(userId);
            return true;
        }
        return false;
    }
    
    demoteAdmin(userId) {
        return this.admins.delete(userId);
    }
    
    getUsersList() {
        const usersList = [];
        this.userData.forEach((user, userId) => {
            usersList.push({
                id: userId,
                name: user.name,
                role: this.getUserRole(userId)
            });
        });
        return usersList;
    }
}

wss.on('connection', (ws) => {
    console.log('🔗 Новое подключение');
    
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            handleMessage(ws, message);
        } catch (error) {
            console.error('Ошибка парсинга сообщения:', error);
        }
    });

    ws.on('close', () => {
        handleDisconnect(ws);
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket ошибка:', error);
    });
});

function handleMessage(ws, message) {
    switch (message.type) {
        case 'join-room':
            handleJoinRoom(ws, message);
            break;
        case 'webrtc-signal':
            handleWebRTCSignal(ws, message);
            break;
        case 'admin-command':
            handleAdminCommand(ws, message);
            break;
        case 'chat-message':
            handleChatMessage(ws, message);
            break;
    }
}

function handleJoinRoom(ws, message) {
    const { roomId, userId, userName } = message;
    
    try {
        // Проверяем существует ли комната
        if (!rooms.has(roomId)) {
            // Создаем новую комнату, этот пользователь - владелец
            rooms.set(roomId, new Room(roomId, userId));
        }
        
        const room = rooms.get(roomId);
        
        // Проверяем не полна ли комната
        if (room.users.size >= MAX_USERS_PER_ROOM) {
            sendTo(ws, {
                type: 'error',
                message: 'Комната переполнена (максимум 10 пользователей)'
            });
            return;
        }
        
        // Добавляем пользователя в комнату
        room.addUser(ws, userId, userName);
        users.set(ws, { userId, roomId });
        
        // Отправляем успешное подключение
        sendTo(ws, {
            type: 'join-success',
            roomId: roomId,
            yourId: userId,
            yourRole: room.getUserRole(userId),
            users: room.getUsersList()
        });
        
        // Уведомляем других участников
        broadcastToRoom(ws, {
            type: 'user-joined',
            user: { 
                id: userId, 
                name: userName,
                role: room.getUserRole(userId)
            }
        }, false);
        
        console.log(`✅ Пользователь ${userName} присоединился к комнате ${roomId}`);
        
    } catch (error) {
        if (error.message === 'ROOM_FULL') {
            sendTo(ws, {
                type: 'error', 
                message: 'Комната переполнена (максимум 10 пользователей)'
            });
        } else {
            sendTo(ws, {
                type: 'error',
                message: 'Ошибка подключения к комнате'
            });
        }
    }
}

function handleWebRTCSignal(ws, message) {
    const user = users.get(ws);
    if (!user) return;
    
    // Пересылаем WebRTC сигнал целевому пользователю
    const targetUser = findUserInRoom(user.roomId, message.targetUserId);
    if (targetUser && targetUser !== ws) {
        sendTo(targetUser, {
            type: 'webrtc-signal',
            signal: message.signal,
            senderUserId: user.userId
        });
    }
}

function handleAdminCommand(ws, message) {
    const user = users.get(ws);
    if (!user) return;
    
    const room = rooms.get(user.roomId);
    if (!room) return;
    
    const userRole = room.getUserRole(user.userId);
    
    // Проверяем права доступа
    if (userRole !== 'owner' && userRole !== 'admin') {
        sendTo(ws, {
            type: 'error',
            message: 'Недостаточно прав'
        });
        return;
    }
    
    const { command, targetUserId } = message;
    
    // Выполняем команду
    switch (command) {
        case 'promote-to-admin':
            if (userRole === 'owner') {
                if (room.promoteToAdmin(targetUserId)) {
                    broadcastToRoom(ws, {
                        type: 'user-promoted',
                        userId: targetUserId,
                        role: 'admin'
                    });
                }
            }
            break;
            
        case 'demote-admin':
            if (userRole === 'owner') {
                if (room.demoteAdmin(targetUserId)) {
                    broadcastToRoom(ws, {
                        type: 'user-demoted', 
                        userId: targetUserId,
                        role: 'user'
                    });
                }
            }
            break;
            
        case 'mute-user':
        case 'disable-camera':
        case 'stop-screen-share':
        case 'kick-user':
            // Проверяем что target не владелец и не админ (если командует не владелец)
            const targetRole = room.getUserRole(targetUserId);
            if (targetRole === 'owner') return; // Владельца нельзя трогать
            if (targetRole === 'admin' && userRole !== 'owner') return; // Админа может трогать только владелец
            
            // Пересылаем команду целевому пользователю
            const targetWs = findUserInRoom(user.roomId, targetUserId);
            if (targetWs) {
                sendTo(targetWs, {
                    type: 'admin-action',
                    action: command,
                    fromUserId: user.userId
                });
            }
            break;
    }
}

function handleChatMessage(ws, message) {
    const user = users.get(ws);
    if (!user) return;
    
    broadcastToRoom(ws, {
        type: 'chat-message',
        message: message.message,
        sender: user.userId,
        timestamp: Date.now()
    });
}

function handleDisconnect(ws) {
    const user = users.get(ws);
    if (!user) return;
    
    const { userId, roomId } = user;
    const room = rooms.get(roomId);
    
    if (room) {
        const userName = room.userData.get(userId)?.name || 'Unknown';
        
        // Удаляем пользователя из комнаты
        room.removeUser(userId);
        
        // Если комната пустая - удаляем её
        if (room.users.size === 0) {
            rooms.delete(roomId);
            console.log(`🗑️ Комната ${roomId} удалена (пустая)`);
        } else {
            // Уведомляем остальных о выходе пользователя
            broadcastToRoom(ws, {
                type: 'user-left',
                userId: userId
            }, false);
        }
        
        console.log(`❌ Пользователь ${userName} покинул комнату ${roomId}`);
    }
    
    users.delete(ws);
}

// ===== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====

function broadcastToRoom(senderWs, message, includeSender = true) {
    const sender = users.get(senderWs);
    if (!sender) return;
    
    const room = rooms.get(sender.roomId);
    if (!room) return;
    
    room.users.forEach(client => {
        if (client === senderWs && !includeSender) return;
        if (client.readyState === WebSocket.OPEN) {
            sendTo(client, message);
        }
    });
}

function findUserInRoom(roomId, userId) {
    const room = rooms.get(roomId);
    if (!room) return null;
    
    const userData = room.userData.get(userId);
    return userData ? userData.ws : null;
}

function sendTo(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    }
}

// ===== ЗАПУСК СЕРВЕРА =====

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`📞 Откройте http://localhost:${PORT} в браузере`);
    console.log(`👥 Максимум пользователей в комнате: ${MAX_USERS_PER_ROOM}`);
});