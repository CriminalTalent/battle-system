/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import CharacterCard from '../packages/battle-web/src/components/battle/CharacterCard';

const basePlayer = {
  id: 'p1',
  name: 'Alice',
  hp: 80,
  maxHp: 100,
  attack: 50,
  defense: 30,
  agility: 40,
  characterImage: { id: 'default', name: 'Default', imageUrl: '/images/characters/default.png' },
  activeEffects: {
    atk1: { type: 'attack_boost', name: '공격력 증가', remainingTurns: 2 }
  }
};

describe('CharacterCard', () => {
  test('renders player name and HP', () => {
    render(<CharacterCard player={basePlayer} showStats={true} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText(/80 \/ 100/)).toBeInTheDocument();
  });

  test('shows spectator badge in spectator mode', () => {
    render(<CharacterCard player={basePlayer} isSpectatorMode />);
    expect(screen.getByText('관전 중')).toBeInTheDocument();
  });

  test('shows detailed stats only when not spectator and showStats=true', () => {
    const { rerender } = render(<CharacterCard player={basePlayer} showStats={true} />);
    expect(screen.getByText('공격')).toBeInTheDocument();
    rerender(<CharacterCard player={basePlayer} isSpectatorMode showStats={true} />);
    expect(screen.queryByText('공격')).not.toBeInTheDocument();
    expect(screen.getByText(/ATK:/)).toBeInTheDocument();
  });

  test('renders active effects chips', () => {
    render(<CharacterCard player={basePlayer} />);
    expect(screen.getByText('공격력 증가')).toBeInTheDocument();
  });

  test('shows current turn indicator when isCurrentPlayer', () => {
    render(<CharacterCard player={basePlayer} isCurrentPlayer />);
    // presence of the ClockIcon parent
    expect(document.querySelector('svg')).toBeInTheDocument();
  });

  test('handles legacy character prop', () => {
    const legacy = { ...basePlayer };
    delete legacy.activeEffects;
    legacy.statusEffects = [{ type: 'poison', duration: 1, source: 'poison' }];
    render(<CharacterCard character={legacy} showStats />);
    expect(screen.getByText('poison')).toBeInTheDocument();
  });
});
