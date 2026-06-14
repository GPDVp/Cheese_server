const WebSocket = require('ws');
const server = new WebSocket.Server({ port: process.env.PORT || 3000 });

let players = [];
let waitingPlayer = null;

server.on('connection', (socket) => {
    console.log('بازیکنی متصل شد');

    // ثبت بازیکن جدید
    if (players.length < 2) {
        players.push(socket);
        socket.send(JSON.stringify({ type: 'role', data: players.length === 1 ? 'white' : 'black' }));
        
        // اگر دو بازیکن شد، بازی شروع شود
        if (players.length === 2) {
            players.forEach(p => p.send(JSON.stringify({ type: 'start' })));
        }
    }

    // دریافت حرکت از بازیکن
    socket.on('message', (message) => {
        const data = JSON.parse(message);
        if (data.type === 'move') {
            // ارسال حرکت به بازیکن دیگر
            const otherPlayer = players.find(p => p !== socket);
            if (otherPlayer) {
                otherPlayer.send(JSON.stringify({ type: 'move', data: data.data }));
            }
        }
    });

    // قطع اتصال
    socket.on('close', () => {
        players = players.filter(p => p !== socket);
        console.log('بازیکنی قطع شد');
    });
});

console.log('سرور روی پورت 3000 اجرا شد');