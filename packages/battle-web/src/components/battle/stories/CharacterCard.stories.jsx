import React from 'react';
import CharacterCard, { SmallCharacterCard, LargeCharacterCard, SpectatorCharacterCard } from '../packages/battle-web/src/components/battle/CharacterCard';

export default {
  title: 'Battle/CharacterCard',
  component: CharacterCard,
  parameters: { layout: 'centered' }
};

const player = {
  id: 'p1',
  name: 'Alice',
  hp: 80,
  maxHp: 100,
  attack: 50,
  defense: 30,
  agility: 40,
  position: 1,
  characterImage: { id: 'default', name: 'Default', imageUrl: '/images/characters/default.png' },
  activeEffects: {
    atk1: { type: 'attack_boost', name: '공격력 증가', remainingTurns: 2 }
  }
};

export const Default = () => <CharacterCard player={player} showStats />;
export const Spectator = () => <CharacterCard player={player} isSpectatorMode />;
export const CurrentTurn = () => <CharacterCard player={player} isCurrentPlayer showStats />;
export const SelectedSelectable = () => <CharacterCard player={player} isSelectable isSelected showStats />;
export const Dead = () => <CharacterCard player={{ ...player, hp: 0 }} showStats />;
export const Small = () => <SmallCharacterCard player={player} showStats />;
export const Large = () => <LargeCharacterCard player={player} showStats />;
export const SpectatorPreset = () => <SpectatorCharacterCard player={player} />;
