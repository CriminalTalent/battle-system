// 최소 파일 서버 (Express + Socket.IO + Multer)
socket.join(battleId);
socket.role = 'admin';
socket.battleId = battleId;
b.sockets.admins.add(socket.id);
socket.emit('authSuccess', { role: 'admin', battleId, roster: b.roster, teams: fixedTeams() });
});


socket.on('playerAuth', ({ battleId, token, name }) => {
const b = battles.get(battleId);
if (!b || token !== b.tokens.player) return socket.emit('authError', { code: 'BAD_PLAYER_TOKEN' });
name = String(name||'').trim();
if (!name) return socket.emit('authError', { code: 'EMPTY_NAME' });
const p = b.roster.find(r => r.name === name);
if (!p) return socket.emit('authError', { code: 'UNKNOWN_PLAYER_NAME' });


socket.join(battleId);
socket.role = 'player';
socket.battleId = battleId;
socket.name = name;
b.sockets.players.set(name, socket.id);
socket.emit('authSuccess', { role: 'player', battleId, me: p, teams: fixedTeams() });
io.to(battleId).emit('battleUpdate', { roster: b.roster });
});


socket.on('spectatorAuth', ({ battleId, token, name }) => {
const b = battles.get(battleId);
if (!b || token !== b.tokens.spectator) return socket.emit('authError', { code: 'BAD_SPECTATOR_TOKEN' });
name = String(name||'').trim() || `관전자_${nid(4)}`;


socket.join(battleId);
socket.role = 'spectator';
socket.battleId = battleId;
socket.name = name;
b.sockets.spectators.add(socket.id);
socket.emit('authSuccess', { role: 'spectator', battleId, name, teams: fixedTeams(), roster: b.roster });
});


// 채팅: 플레이어만 자유 채팅 허용, 관전자는 cheer 전용, 관리자는 금지
socket.on('chatMessage', ({ text }) => {
const b = socket.battleId && battles.get(socket.battleId);
if (!b) return;
if (socket.role !== 'player') return; // 관리자/관전자 차단
text = String(text||'').slice(0, 500);
if (!text.trim()) return;
io.to(b.id).emit('chatMessage', { from: socket.name, role: 'player', text, ts: Date.now() });
});


socket.on('cheerMessage', ({ preset }) => {
const b = socket.battleId && battles.get(socket.battleId);
if (!b) return;
if (socket.role !== 'spectator') return; // 관전자만 허용
const presets = {
a: '응원합니다',
b: '침착하게',
c: '멋진 한 수 기대합니다',
d: '집중하세요',
};
const text = presets[preset] || presets.a;
io.to(b.id).emit('cheerMessage', { from: socket.name, role: 'spectator', text, ts: Date.now() });
});


// 플레이어: 프로필 이미지 갱신
socket.on('updatePlayerImage', ({ path }) => {
const b = socket.battleId && battles.get(socket.battleId);
if (!b || socket.role !== 'player' || !socket.name) return;
const p = b.roster.find(r => r.name === socket.name);
if (!p) return;
p.imageUrl = path;
io.to(b.id).emit('battleUpdate', { roster: b.roster });
socket.emit('updateOk', { imageUrl: path });
});
});


const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
console.log(`Battle server on :${PORT}`);
});
