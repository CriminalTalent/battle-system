// packages/battle-server/index.js
// 플레이어 링크 생성 API 수정

app.post('/api/admin/battles/:id/links', (req, res) => {
  try {
    const battleId = req.params.id;
    const battle = battles.get(battleId);
    if (!battle) return res.status(404).json({ ok: false, error: 'not_found' });

    const base = `${req.protocol}://${req.get('host')}`;
    const spectatorOtp = generateOTP(6);
    
    // 관전자 OTP 저장
    otpStore.set(`spectator_${battleId}`, {
      otp: spectatorOtp,
      battleId,
      role: 'spectator',
      expires: Date.now() + 30 * 60 * 1000,
    });

    const links = [];
    const players = battle.players || [];
    
    players.forEach((player, index) => {
      const playerToken = generateOTP(6);
      const otpKey = `player_${battleId}_${player.id}`;
      
      // 플레이어 토큰 저장
      otpStore.set(otpKey, {
        otp: playerToken,
        battleId,
        role: 'player',
        playerId: player.id,
        playerName: player.name,
        team: player.team,
        expires: Date.now() + 2 * 60 * 60 * 1000, // 2시간
      });
      
      // 자동로그인을 위한 URL 생성 (password와 token 둘 다 포함)
      const playerUrl = `${base}/player.html?battle=${encodeURIComponent(battleId)}&password=${encodeURIComponent(playerToken)}&token=${encodeURIComponent(playerToken)}&playerId=${encodeURIComponent(player.id)}&name=${encodeURIComponent(player.name)}&team=${encodeURIComponent(player.team)}`;
        
      links.push({ 
        id: index + 1, 
        playerId: player.id,
        playerName: player.name,
        team: player.team,
        url: playerUrl
      });
      
      console.log(`Created auto-login link for player ${player.name} (${player.id}): ${playerUrl}`);
    });

    res.json({
      ok: true,
      spectatorOtp,
      spectatorUrl: `${base}/spectator.html?battle=${encodeURIComponent(battleId)}&otp=${encodeURIComponent(spectatorOtp)}`,
      playerLinks: links,
    });
  } catch (e) {
    console.error('Link creation error:', e);
    res.status(500).json({ ok: false, error: 'link_creation_failed' });
  }
});

// 대체 API도 동일하게 수정
app.post('/api/battles/:id/links', (req, res) => {
  try {
    const battleId = req.params.id;
    const battle = battles.get(battleId);
    if (!battle) return res.status(404).json({ ok: false, error: 'not_found' });

    const base = `${req.protocol}://${req.get('host')}`;
    const spectatorOtp = generateOTP(6);
    
    otpStore.set(`spectator_${battleId}`, {
      otp: spectatorOtp,
      battleId,
      role: 'spectator',
      expires: Date.now() + 30 * 60 * 1000,
    });

    const links = [];
    const players = battle.players || [];
    
    players.forEach((player, index) => {
      const playerToken = generateOTP(6);
      const otpKey = `player_${battleId}_${player.id}`;
      
      otpStore.set(otpKey, {
        otp: playerToken,
        battleId,
        role: 'player',
        playerId: player.id,
        playerName: player.name,
        team: player.team,
        expires: Date.now() + 2 * 60 * 60 * 1000,
      });
      
      // 자동로그인을 위한 완전한 URL 생성
      const playerUrl = `${base}/player.html?battle=${encodeURIComponent(battleId)}&password=${encodeURIComponent(playerToken)}&token=${encodeURIComponent(playerToken)}&playerId=${encodeURIComponent(player.id)}&name=${encodeURIComponent(player.name)}&team=${encodeURIComponent(player.team)}`;
      
      links.push({ 
        id: index + 1, 
        playerId: player.id,
        playerName: player.name,
        team: player.team,
        url: playerUrl
      });
    });

    res.json({
      ok: true,
      spectatorOtp,
      spectatorUrl: `${base}/spectator.html?battle=${encodeURIComponent(battleId)}&otp=${encodeURIComponent(spectatorOtp)}`,
      playerLinks: links,
    });
  } catch (e) {
    console.error('Link creation error:', e);
    res.status(500).json({ ok: false, error: 'link_creation_failed' });
  }
});
