// packages/battle-web/src/app/watch/[roomId]/page.js
'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { 
  EyeIcon, 
  ExclamationTriangleIcon,
  ArrowLeftIcon,
  UserIcon,
  GlobeAltIcon
} from '@heroicons/react/24/outline';
import SpectatorView from '../../../components/battle/SpectatorView';
import { useSocket } from '../../../hooks/useSocket';

export default function WatchPage() {
  const params = useParams();
  const router = useRouter();
  const socket = useSocket();
  const [battleId, setBattleId] = useState(null);
  const [spectatorName, setSpectatorName] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const [joined, setJoined] = useState(false);
  const [error, setError] = useState(null);
  const [battleExists, setBattleExists] = useState(null);

  useEffect(() => {
    if (params.roomId) {
      setBattleId(params.roomId);
      
      // 저장된 관전자 이름 불러오기
      const savedName = localStorage.getItem('spectator_name');
      if (savedName) {
        setSpectatorName(savedName);
      }
    }
  }, [params.roomId]);

  useEffect(() => {
    if (!socket || !battleId) return;

    // 배틀 존재 여부 확인
    socket.emit('check_battle_exists', { battleId });

    const handleBattleExists = (data) => {
      setBattleExists(data.exists);
      if (!data.exists) {
        setError('존재하지 않는 배틀입니다.');
      }
    };

    const handleError = (errorData) => {
      setError(errorData.message);
      setIsJoining(false);
    };

    socket.on('battle_exists', handleBattleExists);
    socket.on('error', handleError);

    return () => {
      socket.off('battle_exists', handleBattleExists);
      socket.off('error', handleError);
    };
  }, [socket, battleId]);

  const handleJoinAsSpectator = async () => {
    if (!spectatorName.trim()) {
      setError('관전자 이름을 입력해주세요.');
      return;
    }

    if (!socket || !battleId) {
      setError('연결 상태를 확인해주세요.');
      return;
    }

    setIsJoining(true);
    setError(null);

    try {
      // 관전자 이름 저장
      localStorage.setItem('spectator_name', spectatorName.trim());

      setJoined(true);
    } catch (error) {
      console.error('Error joining as spectator:', error);
      setError('관전 참여 중 오류가 발생했습니다.');
      setIsJoining(false);
    }
  };

  const handleBack = () => {
    router.push('/');
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleJoinAsSpectator();
    }
  };

  // 이미 관전자로 참여한 경우
  if (joined) {
    return (
      <SpectatorView 
        battleId={battleId}
        initialSpectatorInfo={{
          name: spectatorName.trim()
        }}
      />
    );
  }

  // 배틀이 존재하지 않는 경우
  if (battleExists === false) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-900 via-red-800 to-red-900 flex items-center justify-center">
        <div className="max-w-md w-full mx-4">
          <motion.div
            className="bg-white/10 backdrop-blur-lg rounded-3xl p-8 border border-white/20 text-center"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5 }}
          >
            <div className="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
              <ExclamationTriangleIcon className="w-10 h-10 text-red-400" />
            </div>
            <h1 className="text-3xl font-bold text-white mb-4">배틀을 찾을 수 없음</h1>
            <p className="text-red-200 mb-6 leading-relaxed">
              요청하신 배틀이 존재하지 않거나 이미 종료되었습니다.
              <br />
              올바른 링크인지 확인해주세요.
            </p>
            <button
              onClick={handleBack}
              className="inline-flex items-center px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl transition-colors"
            >
              <ArrowLeftIcon className="w-5 h-5 mr-2" />
              메인으로 돌아가기
            </button>
          </motion.div>
        </div>
      </div>
    );
  }

  // 로딩 중
  if (battleExists === null) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900 flex items-center justify-center">
        <div className="max-w-md w-full mx-4">
          <motion.div
            className="bg-white/10 backdrop-blur-lg rounded-3xl p-8 border border-white/20 text-center"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5 }}
          >
            <div className="w-20 h-20 bg-blue-500/20 rounded-full flex items-center justify-center mx-auto mb-6 animate-pulse">
              <GlobeAltIcon className="w-10 h-10 text-blue-400" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-4">배틀 확인 중...</h1>
            <p className="text-blue-200">잠시만 기다려주세요.</p>
          </motion.div>
        </div>
      </div>
    );
  }

  // 관전자 이름 입력 화면
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-900 flex items-center justify-center relative overflow-hidden">
      {/* 배경 효과 */}
      <div className="absolute inset-0 bg-[url('/images/battle-bg.jpg')] bg-cover bg-center opacity-5" />
      <div className="absolute inset-0">
        <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-purple-500/10 rounded-full blur-3xl animate-pulse delay-1000" />
      </div>

      <div className="max-w-md w-full mx-4 relative z-10">
        <motion.div
          className="bg-white/10 backdrop-blur-lg rounded-3xl p-8 border border-white/20"
          initial={{ scale: 0.8, opacity: 0, y: 50 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          transition={{ duration: 0.6, type: 'spring', damping: 15 }}
        >
          {/* 헤더 */}
          <div className="text-center mb-8">
            <motion.div
              className="w-20 h-20 bg-gradient-to-br from-blue-500/20 to-purple-500/20 rounded-full flex items-center justify-center mx-auto mb-4"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              <EyeIcon className="w-10 h-10 text-blue-400" />
            </motion.div>
            <motion.h1
              className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent mb-2"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
            >
              배틀 관전
            </motion.h1>
            <motion.p
              className="text-blue-200/80"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.4 }}
            >
              실시간으로 배틀을 관전해보세요
            </motion.p>
          </div>

          {/* 배틀 정보 */}
          <motion.div
            className="bg-white/5 rounded-xl p-4 mb-6 border border-white/10"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.5 }}
          >
            <h3 className="text-sm font-medium text-white/60 mb-2">배틀 ID</h3>
            <p className="text-lg font-mono text-white bg-black/20 rounded-lg px-3 py-2 break-all">
              {battleId}
            </p>
          </motion.div>

          {/* 관전자 이름 입력 */}
          <motion.div
            className="space-y-4"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.6 }}
          >
            <div>
              <label className="block text-sm font-medium text-white/80 mb-2">
                관전자 이름
              </label>
              <div className="relative">
                <UserIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-white/40" />
                <input
                  type="text"
                  value={spectatorName}
                  onChange={(e) => setSpectatorName(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="관전자 이름을 입력하세요"
                  className="w-full pl-10 pr-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/40 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all"
                  maxLength={20}
                  autoFocus
                />
              </div>
            </div>

            {error && (
              <motion.div
                className="bg-red-500/10 border border-red-500/30 rounded-lg p-3"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3 }}
              >
                <div className="flex items-center">
                  <ExclamationTriangleIcon className="w-5 h-5 text-red-400 mr-2" />
                  <p className="text-sm text-red-200">{error}</p>
                </div>
              </motion.div>
            )}

            <div className="flex space-x-3">
              <button
                onClick={handleBack}
                className="flex-1 py-3 bg-white/10 hover:bg-white/20 border border-white/20 text-white rounded-xl transition-all duration-200 font-medium"
              >
                취소
              </button>
              <button
                onClick={handleJoinAsSpectator}
                disabled={!spectatorName.trim() || isJoining}
                className="flex-1 py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 disabled:from-gray-600 disabled:to-gray-600 disabled:cursor-not-allowed text-white rounded-xl transition-all duration-200 font-medium"
              >
                {isJoining ? (
                  <div className="flex items-center justify-center">
                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                    연결 중...
                  </div>
                ) : (
                  '관전 시작'
                )}
              </button>
            </div>
          </motion.div>

          {/* 관전 안내 */}
          <motion.div
            className="mt-6 p-4 bg-blue-500/10 rounded-xl border border-blue-500/20"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.7 }}
          >
            <h4 className="text-sm font-medium text-blue-300 mb-2">관전 모드 안내</h4>
            <ul className="text-xs text-blue-200/80 space-y-1">
              <li>• 실시간으로 배틀 진행상황을 확인할 수 있습니다</li>
              <li>• 다른 관전자들과 채팅할 수 있습니다</li>
              <li>• 플레이어의 아이템 정보는 숨겨집니다</li>
              <li>• 언제든지 관전을 종료할 수 있습니다</li>
            </ul>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
