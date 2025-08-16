// packages/battle-web/src/components/admin/SpectatorManagement.js
'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  EyeIcon, 
  UserGroupIcon,
  LinkIcon,
  BanIcon,
  CheckBadgeIcon,
  ClipboardDocumentIcon,
  ExclamationTriangleIcon,
  ChartBarIcon,
  GlobeAltIcon,
  ShieldExclamationIcon
} from '@heroicons/react/24/outline';
import { useSocket } from '../../hooks/useSocket';

const SpectatorManagement = ({ battleId, playerId, isAdmin = false }) => {
  const socket = useSocket();
  const [spectators, setSpectators] = useState([]);
  const [spectatorCount, setSpectatorCount] = useState(0);
  const [inviteLinks, setInviteLinks] = useState([]);
  const [bannedSpectators, setBannedSpectators] = useState([]);
  const [stats, setStats] = useState(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showStatsModal, setShowStatsModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!socket || !battleId) return;

    // 관전자 정보 요청
    socket.emit('get_battle_spectators', { battleId });

    // 소켓 이벤트 리스너
    const handleSpectatorUpdate = (data) => {
      setSpectatorCount(data.spectatorCount);
      
      if (data.type === 'joined') {
        setSpectators(prev => [...prev, data.spectator]);
      } else if (data.type === 'left') {
        setSpectators(prev => prev.filter(s => s.id !== data.spectator.id));
      }
    };

    const handleSpectatorsList = (data) => {
      setSpectators(data.spectators);
      setSpectatorCount(data.spectators.length);
    };

    const handleInviteGenerated = (data) => {
      setInviteLinks(prev => [...prev, data]);
      setShowInviteModal(false);
    };

    const handleSpectatorBanned = (data) => {
      setBannedSpectators(prev => [...prev, data.spectatorId]);
      setSpectators(prev => prev.filter(s => s.id !== data.spectatorId));
    };

    const handleSpectatorStats = (data) => {
      setStats(data);
    };

    const handleError = (error) => {
      setError(error.message);
      setLoading(false);
    };

    socket.on('spectator_update', handleSpectatorUpdate);
    socket.on('battle_spectators', handleSpectatorsList);
    socket.on('spectator_invite_generated', handleInviteGenerated);
    socket.on('spectator_banned', handleSpectatorBanned);
    socket.on('spectator_stats', handleSpectatorStats);
    socket.on('error', handleError);

    return () => {
      socket.off('spectator_update', handleSpectatorUpdate);
      socket.off('battle_spectators', handleSpectatorsList);
      socket.off('spectator_invite_generated', handleInviteGenerated);
      socket.off('spectator_banned', handleSpectatorBanned);
      socket.off('spectator_stats', handleSpectatorStats);
      socket.off('error', handleError);
    };
  }, [socket, battleId]);

  const generateInviteLink = () => {
    if (!socket || !isAdmin) return;

    setLoading(true);
    socket.emit('generate_spectator_invite', {
      battleId,
      playerId
    });
  };

  const banSpectator = (spectatorId) => {
    if (!socket || !isAdmin) return;

    socket.emit('ban_spectator', {
      battleId,
      spectatorId,
      playerId
    });
  };

  const unbanSpectator = (spectatorId) => {
    if (!socket || !isAdmin) return;

    socket.emit('unban_spectator', {
      battleId,
      spectatorId,
      playerId
    });
  };

  const getSpectatorStats = () => {
    if (!socket || !isAdmin) return;

    setLoading(true);
    socket.emit('get_spectator_stats', {
      battleId,
      adminKey: process.env.NEXT_PUBLIC_ADMIN_KEY
    });
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => {
      // 복사 성공 알림
    });
  };

  const getPublicSpectatorUrl = () => {
    return `${window.location.origin}/watch/${battleId}`;
  };

  if (!isAdmin) {
    // 일반 플레이어용 간단한 관전자 정보
    return (
      <div className="bg-white/5 backdrop-blur-lg rounded-xl p-4 border border-white/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <EyeIcon className="w-5 h-5 text-purple-400" />
            <span className="text-white font-medium">관전자</span>
          </div>
          <div className="flex items-center space-x-2">
            <UserGroupIcon className="w-4 h-4 text-purple-400" />
            <span className="text-purple-200">{spectatorCount}명</span>
          </div>
        </div>
        
        <div className="mt-3 pt-3 border-t border-white/10">
          <button
            onClick={() => copyToClipboard(getPublicSpectatorUrl())}
            className="w-full flex items-center justify-center space-x-2 py-2 bg-purple-600/20 hover:bg-purple-600/30 rounded-lg transition-colors"
          >
            <LinkIcon className="w-4 h-4" />
            <span className="text-sm">관전 링크 복사</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 관전자 현황 */}
      <div className="bg-white/5 backdrop-blur-lg rounded-xl p-6 border border-white/10">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-white flex items-center">
            <EyeIcon className="w-5 h-5 mr-2" />
            관전자 관리
          </h3>
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2 bg-purple-600/20 px-3 py-1 rounded-full">
              <UserGroupIcon className="w-4 h-4 text-purple-400" />
              <span className="text-purple-200">{spectatorCount}명 관전 중</span>
            </div>
            <button
              onClick={getSpectatorStats}
              disabled={loading}
              className="p-2 bg-blue-600/20 hover:bg-blue-600/30 rounded-lg transition-colors"
            >
              <ChartBarIcon className="w-4 h-4 text-blue-400" />
            </button>
          </div>
        </div>

        {/* 빠른 액션 */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <button
            onClick={() => setShowInviteModal(true)}
            className="flex items-center justify-center space-x-2 py-3 bg-green-600/20 hover:bg-green-600/30 rounded-lg transition-colors"
          >
            <LinkIcon className="w-4 h-4 text-green-400" />
            <span className="text-green-200">초대 링크 생성</span>
          </button>
          <button
            onClick={() => copyToClipboard(getPublicSpectatorUrl())}
            className="flex items-center justify-center space-x-2 py-3 bg-purple-600/20 hover:bg-purple-600/30 rounded-lg transition-colors"
          >
            <GlobeAltIcon className="w-4 h-4 text-purple-400" />
            <span className="text-purple-200">공개 링크 복사</span>
          </button>
        </div>

        {/* 현재 관전자 목록 */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-white/80">현재 관전자</h4>
          <div className="max-h-40 overflow-y-auto space-y-2">
            {spectators.map((spectator) => (
              <motion.div
                key={spectator.id}
                className="flex items-center justify-between p-3 bg-white/5 rounded-lg"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
              >
                <div className="flex items-center space-x-3">
                  <div className="w-8 h-8 bg-purple-600/20 rounded-full flex items-center justify-center">
                    <EyeIcon className="w-4 h-4 text-purple-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">{spectator.name}</p>
                    <p className="text-xs text-gray-400">
                      {new Date(spectator.joinedAt).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => banSpectator(spectator.id)}
                  className="p-1 text-red-400 hover:bg-red-500/20 rounded transition-colors"
                  title="관전자 추방"
                >
                  <BanIcon className="w-4 h-4" />
                </button>
              </motion.div>
            ))}
            {spectators.length === 0 && (
              <div className="text-center py-6 text-gray-400">
                <EyeIcon className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">현재 관전자가 없습니다</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 생성된 초대 링크 */}
      {inviteLinks.length > 0 && (
        <div className="bg-white/5 backdrop-blur-lg rounded-xl p-6 border border-white/10">
          <h4 className="text-sm font-medium text-white/80 mb-3">생성된 초대 링크</h4>
          <div className="space-y-2">
            {inviteLinks.map((invite, index) => (
              <div key={index} className="flex items-center justify-between p-3 bg-white/5 rounded-lg">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white font-mono truncate">{invite.url}</p>
                  <p className="text-xs text-gray-400">
                    만료: {new Date(invite.expiresAt).toLocaleString()}
                  </p>
                </div>
                <button
                  onClick={() => copyToClipboard(invite.url)}
                  className="ml-2 p-2 text-blue-400 hover:bg-blue-500/20 rounded transition-colors"
                >
                  <ClipboardDocumentIcon className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 차단된 관전자 */}
      {bannedSpectators.length > 0 && (
        <div className="bg-white/5 backdrop-blur-lg rounded-xl p-6 border border-white/10">
          <h4 className="text-sm font-medium text-white/80 mb-3 flex items-center">
            <ShieldExclamationIcon className="w-4 h-4 mr-2 text-red-400" />
            차단된 관전자
          </h4>
          <div className="space-y-2">
            {bannedSpectators.map((spectatorId) => (
              <div key={spectatorId} className="flex items-center justify-between p-3 bg-red-500/10 rounded-lg border border-red-500/20">
                <span className="text-sm text-red-200">{spectatorId}</span>
                <button
                  onClick={() => unbanSpectator(spectatorId)}
                  className="text-xs px-3 py-1 bg-green-600/20 hover:bg-green-600/30 text-green-200 rounded transition-colors"
                >
                  해제
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 에러 표시 */}
      <AnimatePresence>
        {error && (
          <motion.div
            className="bg-red-500/10 border border-red-500/30 rounded-lg p-4"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
          >
            <div className="flex items-center">
              <ExclamationTriangleIcon className="w-5 h-5 text-red-400 mr-2" />
              <p className="text-sm text-red-200">{error}</p>
              <button
                onClick={() => setError(null)}
                className="ml-auto text-red-400 hover:text-red-300"
              >
                ×
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 초대 링크 생성 모달 */}
      <AnimatePresence>
        {showInviteModal && (
          <motion.div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="bg-gray-900 rounded-2xl p-6 border border-white/20 max-w-md w-full"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
            >
              <h3 className="text-lg font-bold text-white mb-4">관전자 초대 링크 생성</h3>
              <p className="text-gray-300 mb-6">
                이 링크는 24시간 후 만료되며, 특정 관전자만 접근할 수 있습니다.
              </p>
              
              <div className="flex space-x-3">
                <button
                  onClick={() => setShowInviteModal(false)}
                  className="flex-1 py-3 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors"
                >
                  취소
                </button>
                <button
                  onClick={generateInviteLink}
                  disabled={loading}
                  className="flex-1 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white rounded-lg transition-colors"
                >
                  {loading ? '생성 중...' : '링크 생성'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 통계 모달 */}
      <AnimatePresence>
        {showStatsModal && stats && (
          <motion.div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="bg-gray-900 rounded-2xl p-6 border border-white/20 max-w-2xl w-full max-h-96 overflow-y-auto"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-white">관전자 통계</h3>
                <button
                  onClick={() => setShowStatsModal(false)}
                  className="text-gray-400 hover:text-white"
                >
                  ×
                </button>
              </div>
              
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-white/5 rounded-lg p-4">
                  <div className="text-2xl font-bold text-blue-400">{stats.currentSpectators}</div>
                  <div className="text-sm text-gray-400">현재 관전자</div>
                </div>
                <div className="bg-white/5 rounded-lg p-4">
                  <div className="text-2xl font-bold text-green-400">{stats.totalVisitors || 0}</div>
                  <div className="text-sm text-gray-400">총 방문자</div>
                </div>
              </div>

              {/* 상세 통계는 필요에 따라 확장 */}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default SpectatorManagement;
