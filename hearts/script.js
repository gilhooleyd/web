/* Hearts Card Game - Script */

// Constants
const SUITS = {
  CLUBS: 'clubs',
  DIAMONDS: 'diamonds',
  SPADES: 'spades',
  HEARTS: 'hearts'
};

const SUIT_SYMBOLS = {
  [SUITS.CLUBS]: '♣',
  [SUITS.DIAMONDS]: '♦',
  [SUITS.SPADES]: '♠',
  [SUITS.HEARTS]: '♥'
};

const VALUES = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
  11: 'J', 12: 'Q', 13: 'K', 14: 'A'
};

// Phase types
const PHASES = {
  DEALING: 'DEALING',
  PASSING: 'PASSING',
  PLAYING: 'PLAYING',
  ROUND_OVER: 'ROUND_OVER',
  GAME_OVER: 'GAME_OVER'
};

const PASSING_DIRECTIONS = {
  LEFT: 'LEFT',
  RIGHT: 'RIGHT',
  ACROSS: 'ACROSS',
  NONE: 'NONE'
};

// Card Class
class Card {
  constructor(suit, value) {
    this.suit = suit;
    this.value = value; // Numeric representation 2 to 14
    this.id = `${suit}_${value}`;
  }

  getSymbol() {
    return SUIT_SYMBOLS[this.suit];
  }

  getDisplayValue() {
    return VALUES[this.value];
  }

  getPoints() {
    if (this.suit === SUITS.HEARTS) return 1;
    if (this.suit === SUITS.SPADES && this.value === 12) return 13; // Queen of Spades
    return 0;
  }

  isQueenOfSpades() {
    return this.suit === SUITS.SPADES && this.value === 12;
  }
}

// Player Class
class Player {
  constructor(id, name, isAI = true) {
    this.id = id;
    this.name = name;
    this.isAI = isAI;
    this.hand = [];
    this.selectedCards = []; // For passing phase
    this.roundScore = 0;
    this.gameScore = 0;
  }

  resetForNewRound() {
    this.hand = [];
    this.selectedCards = [];
    this.roundScore = 0;
  }

  sortHand() {
    const suitOrder = [SUITS.CLUBS, SUITS.DIAMONDS, SUITS.SPADES, SUITS.HEARTS];
    this.hand.sort((a, b) => {
      if (a.suit !== b.suit) {
        return suitOrder.indexOf(a.suit) - suitOrder.indexOf(b.suit);
      }
      return a.value - b.value;
    });
  }

  removeCard(cardId) {
    const index = this.hand.findIndex(c => c.id === cardId);
    if (index !== -1) {
      return this.hand.splice(index, 1)[0];
    }
    return null;
  }
}

// Main Hearts Game State
class HeartsGame {
  constructor() {
    this.players = [
      new Player(0, 'You (South)', false),
      new Player(1, 'West (AI)', true),
      new Player(2, 'North (AI)', true),
      new Player(3, 'East (AI)', true)
    ];
    this.currentRound = 1;
    this.phase = PHASES.DEALING;
    this.currentTrick = []; // Array of { playerId, card }
    this.tricksPlayedThisRound = 0;
    this.heartsBroken = false;
    this.turn = 0; // Index of active player
    this.startingPlayerId = null; // Player who plays first in a trick
    this.isAiWaiting = false;
    this.messageText = '';
  }

  getPassingDirection() {
    const modes = [
      PASSING_DIRECTIONS.LEFT,
      PASSING_DIRECTIONS.RIGHT,
      PASSING_DIRECTIONS.ACROSS,
      PASSING_DIRECTIONS.NONE
    ];
    return modes[(this.currentRound - 1) % 4];
  }

  startNewGame() {
    this.currentRound = 1;
    this.players.forEach(p => {
      p.gameScore = 0;
      p.resetForNewRound();
    });
    this.startNewRound();
  }

  startNewRound() {
    this.phase = PHASES.DEALING;
    this.currentTrick = [];
    this.tricksPlayedThisRound = 0;
    this.heartsBroken = false;
    this.isAiWaiting = false;

    this.players.forEach(p => p.resetForNewRound());

    // Create Deck
    let deck = [];
    for (const suit of Object.values(SUITS)) {
      for (let val = 2; val <= 14; val++) {
        deck.push(new Card(suit, val));
      }
    }

    // Shuffle Deck
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    // Deal Cards (13 each)
    for (let i = 0; i < 52; i++) {
      this.players[i % 4].hand.push(deck[i]);
    }

    // Sort Hands
    this.players.forEach(p => p.sortHand());

    const dir = this.getPassingDirection();
    if (dir === PASSING_DIRECTIONS.NONE) {
      this.phase = PHASES.PLAYING;
      this.setupFirstTrick();
    } else {
      this.phase = PHASES.PASSING;
      this.messageText = `Select 3 cards to pass to the ${dir.toLowerCase()}.`;
      // AI Players auto-select passing cards
      this.aiSelectPasses();
    }
    m.redraw();
  }

  // AI selects passes
  aiSelectPasses() {
    this.players.forEach(p => {
      if (!p.isAI) return;
      
      // AI Logic to choose 3 cards to pass:
      // 1. High spades if they have high risk of Q of Spades.
      // 2. Highest cards in hand to avoid taking points.
      // Sort hand descending by value, prioritizing high spades and high hearts
      let candidates = [...p.hand].sort((a, b) => {
        // Value weight
        let weightA = a.value;
        let weightB = b.value;
        
        // Spades Ace/King/Queen are dangerous
        if (a.suit === SUITS.SPADES && a.value >= 12) weightA += 10;
        if (b.suit === SUITS.SPADES && b.value >= 12) weightB += 10;
        
        return weightB - weightA; // Descending
      });

      p.selectedCards = candidates.slice(0, 3);
    });
  }

  // Execute the Card Passing phase
  executePassing() {
    const dir = this.getPassingDirection();
    const passOffsets = {
      [PASSING_DIRECTIONS.LEFT]: 1,
      [PASSING_DIRECTIONS.RIGHT]: 3, // (i - 1 + 4) % 4
      [PASSING_DIRECTIONS.ACROSS]: 2
    };

    const offset = passOffsets[dir];
    const passedCardsMap = {};

    // Remove selected cards from all players
    this.players.forEach(p => {
      passedCardsMap[p.id] = p.selectedCards.map(c => p.removeCard(c.id));
      p.selectedCards = [];
    });

    // Distribute passed cards
    this.players.forEach(p => {
      const sourcePlayerId = (p.id - offset + 4) % 4;
      const incomingCards = passedCardsMap[sourcePlayerId];
      p.hand.push(...incomingCards);
      p.sortHand();
    });

    this.phase = PHASES.PLAYING;
    this.setupFirstTrick();
    m.redraw();
  }

  setupFirstTrick() {
    // Find player with 2 of Clubs to start first trick
    let starter = 0;
    this.players.forEach(p => {
      const hasTwoOfClubs = p.hand.some(c => c.suit === SUITS.CLUBS && c.value === 2);
      if (hasTwoOfClubs) {
        starter = p.id;
      }
    });

    this.startingPlayerId = starter;
    this.turn = starter;
    this.messageText = `${this.players[starter].name} leads the first trick with the 2 of Clubs.`;

    // Trigger AI play if it's an AI turn
    this.checkAiPlay();
  }

  // AI player card selection logic
  aiPlayCard(player) {
    const playable = this.getPlayableCards(player);
    if (playable.length === 0) return;

    // AI logic strategy:
    // 1. If they must play a specific card (e.g. 2 of clubs on first trick), play it.
    let selectedCard = playable[0];

    const trickLead = this.currentTrick[0];
    
    if (trickLead) {
      // AI is following suit
      const leadSuit = trickLead.card.suit;
      const isPointsInTrick = this.currentTrick.some(t => t.card.getPoints() > 0);
      
      // Find highest card played in lead suit so far
      let highestInSuit = trickLead.card;
      this.currentTrick.forEach(t => {
        if (t.card.suit === leadSuit && t.card.value > highestInSuit.value) {
          highestInSuit = t.card;
        }
      });

      // Filter playable cards matching lead suit
      const suitCards = playable.filter(c => c.suit === leadSuit);
      
      if (suitCards.length > 0) {
        // Can follow suit.
        // Tries to play the highest card that is lower than highestInSuit to avoid taking the trick
        const lowerCards = suitCards.filter(c => c.value < highestInSuit.value).sort((a,b) => b.value - a.value);
        if (lowerCards.length > 0) {
          selectedCard = lowerCards[0]; // Safely dump highest safe card
        } else {
          // Must play higher, play the highest to waste a high card
          selectedCard = suitCards.sort((a,b) => b.value - a.value)[0];
        }
      } else {
        // Can't follow suit, discard!
        // 1. Play Queen of Spades if they have it
        const QSpades = playable.find(c => c.isQueenOfSpades());
        if (QSpades) {
          selectedCard = QSpades;
        } else {
          // 2. Play highest hearts
          const hearts = playable.filter(c => c.suit === SUITS.HEARTS).sort((a,b) => b.value - a.value);
          if (hearts.length > 0) {
            selectedCard = hearts[0];
          } else {
            // 3. Play highest card of any other suit
            selectedCard = playable.sort((a,b) => b.value - a.value)[0];
          }
        }
      }
    } else {
      // AI is leading the trick!
      // Avoid leading high cards if they want to play safe.
      // Don't lead Hearts unless they have to.
      const safeLeads = playable.filter(c => c.suit !== SUITS.HEARTS);
      if (safeLeads.length > 0) {
        // Lead lowest card in safe suit
        selectedCard = safeLeads.sort((a,b) => a.value - b.value)[0];
      } else {
        // Tries to play lowest Heart
        selectedCard = playable.sort((a,b) => a.value - b.value)[0];
      }
    }

    this.playCard(player, selectedCard);
  }

  // Check if a card is playable by a player
  isCardPlayable(player, card) {
    const playable = this.getPlayableCards(player);
    return playable.some(c => c.id === card.id);
  }

  getPlayableCards(player) {
    const hand = player.hand;

    // Trick 1: Must lead 2 of Clubs
    if (this.tricksPlayedThisRound === 0 && this.currentTrick.length === 0) {
      const twoClubs = hand.find(c => c.suit === SUITS.CLUBS && c.value === 2);
      return twoClubs ? [twoClubs] : hand;
    }

    // Trick 1 general rule: No points allowed on first trick unless player only has points cards
    if (this.tricksPlayedThisRound === 0) {
      const leadCard = this.currentTrick[0]?.card;
      if (leadCard) {
        const suit = leadCard.suit;
        const matchingSuit = hand.filter(c => c.suit === suit);
        if (matchingSuit.length > 0) {
          return matchingSuit;
        }
        // Can't follow suit: must not play points if possible
        const nonPoints = hand.filter(c => c.getPoints() === 0);
        return nonPoints.length > 0 ? nonPoints : hand;
      }
    }

    // Standard trick-taking rules
    const leadCard = this.currentTrick[0]?.card;
    if (leadCard) {
      // Must follow suit if possible
      const suit = leadCard.suit;
      const matchingSuit = hand.filter(c => c.suit === suit);
      if (matchingSuit.length > 0) {
        return matchingSuit;
      }
      // Can play anything
      return hand;
    }

    // Leading a new trick
    // Cannot lead Hearts unless hearts broken, or player has only hearts
    if (!this.heartsBroken) {
      const nonHearts = hand.filter(c => c.suit !== SUITS.HEARTS);
      if (nonHearts.length > 0) {
        return nonHearts;
      }
    }

    return hand;
  }

  playCard(player, card) {
    player.removeCard(card.id);
    this.currentTrick.push({ playerId: player.id, card });

    if (card.suit === SUITS.HEARTS && !this.heartsBroken) {
      this.heartsBroken = true;
      this.messageText = `Hearts have been broken!`;
    }

    this.turn = (this.turn + 1) % 4;
    m.redraw();

    // If trick is complete (4 cards played)
    if (this.currentTrick.length === 4) {
      this.isAiWaiting = true;
      
      // Pre-calculate winner for collection animation direction
      const lead = this.currentTrick[0].card;
      const leadSuit = lead.suit;
      let winningPlay = this.currentTrick[0];
      this.currentTrick.forEach(play => {
        if (play.card.suit === leadSuit && play.card.value > winningPlay.card.value) {
          winningPlay = play;
        }
      });
      this.trickWinnerId = winningPlay.playerId;

      // Add a pause to view final trick, then trigger collection fly-away
      setTimeout(() => {
        this.isCollecting = true;
        m.redraw();

        // Wait for fly-away animation to finish before scoring and clearing
        setTimeout(() => {
          this.resolveTrick();
        }, 600);
      }, 1200);
    } else {
      this.checkAiPlay();
    }
  }

  checkAiPlay() {
    if (this.phase !== PHASES.PLAYING || this.isAiWaiting) return;

    const currentPlayer = this.players[this.turn];
    if (currentPlayer.isAI) {
      this.isAiWaiting = true;
      setTimeout(() => {
        this.isAiWaiting = false;
        this.aiPlayCard(currentPlayer);
      }, 800); // Smooth step timing
    }
  }

  resolveTrick() {
    const lead = this.currentTrick[0].card;
    const leadSuit = lead.suit;
    
    let winningPlay = this.currentTrick[0];
    
    this.currentTrick.forEach(play => {
      if (play.card.suit === leadSuit && play.card.value > winningPlay.card.value) {
        winningPlay = play;
      }
    });

    const winnerId = winningPlay.playerId;
    const trickPoints = this.currentTrick.reduce((sum, play) => sum + play.card.getPoints(), 0);

    this.players[winnerId].roundScore += trickPoints;
    this.turn = winnerId;
    this.startingPlayerId = winnerId;
    this.tricksPlayedThisRound += 1; // Restore trick counter increment
    
    // Reset collection states
    this.currentTrick = [];
    this.isCollecting = false;
    this.trickWinnerId = null;
    this.isAiWaiting = false;

    if (trickPoints > 0) {
      this.messageText = `${this.players[winnerId].name} won the trick and took ${trickPoints} points.`;
    } else {
      this.messageText = `${this.players[winnerId].name} won the trick.`;
    }

    // If 13 tricks are done, end the round
    if (this.tricksPlayedThisRound === 13) {
      this.resolveRound();
    } else {
      this.checkAiPlay();
    }
    m.redraw();
  }

  resolveRound() {
    this.phase = PHASES.ROUND_OVER;
    
    // Check for "Shooting the Moon"
    let moonShooter = null;
    this.players.forEach(p => {
      if (p.roundScore === 26) {
        moonShooter = p;
      }
    });

    if (moonShooter) {
      this.messageText = `🌙 WOW! ${moonShooter.name} Shot the Moon! Everyone else gets +26 points!`;
      this.players.forEach(p => {
        if (p.id === moonShooter.id) {
          p.roundScore = 0;
        } else {
          p.roundScore = 26;
        }
      });
    }

    // Add to cumulative scores
    this.players.forEach(p => {
      p.gameScore += p.roundScore;
    });

    // Check if game over (any score >= 100)
    const maxScore = Math.max(...this.players.map(p => p.gameScore));
    if (maxScore >= 100) {
      this.phase = PHASES.GAME_OVER;
      const winner = [...this.players].sort((a, b) => a.gameScore - b.gameScore)[0];
      this.messageText = `🏆 GAME OVER! ${winner.name} wins the match with ${winner.gameScore} points!`;
    } else {
      this.currentRound += 1;
    }
  }
}

// Instantiation
const GameState = new HeartsGame();

// Helper UI Component: Individual Card Component
const CardComponent = {
  oninit: (vnode) => {
    vnode.state.tiltX = 0;
    vnode.state.tiltY = 0;
  },
  view: (vnode) => {
    const card = vnode.attrs.card;
    const index = vnode.attrs.index;
    const total = vnode.attrs.total;
    const isBack = vnode.attrs.back;
    const isPlayable = vnode.attrs.playable;
    const isSelected = vnode.attrs.selected;
    const onclick = vnode.attrs.onclick;

    let extraClasses = '';
    if (isBack) extraClasses += ' back';
    if (isSelected) extraClasses += ' selected';
    if (!isBack && card?.isQueenOfSpades()) extraClasses += ' queen-of-spades';

    let styleString = `--index: ${index}; --total-cards: ${total};`;

    if (!isBack && isPlayable && !isSelected) {
      styleString += ` --tilt-x: ${vnode.state.tiltX}deg; --tilt-y: ${vnode.state.tiltY}deg;`;
    }

    return m('div.card-wrapper', {
      style: styleString,
      class: isSelected ? 'selected' : ''
    }, m('div.card', {
      class: extraClasses,
      onclick: onclick,
      onmousemove: (e) => {
        if (isBack || !isPlayable || isSelected) return;
        // Balatro springy tilt on hover
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left - rect.width / 2;
        const y = e.clientY - rect.top - rect.height / 2;
        vnode.state.tiltX = (x / rect.width) * 15;
        vnode.state.tiltY = -(y / rect.height) * 15;
      },
      onmouseleave: () => {
        vnode.state.tiltX = 0;
        vnode.state.tiltY = 0;
      }
    }, isBack ? [] : [
      m('div.card-value-top', { class: `suit-${card.suit}` }, [
        m('span', card.getDisplayValue()),
        m('span', card.getSymbol())
      ]),
      m('div.card-suit-center', { class: `suit-${card.suit}` }, card.getSymbol()),
      m('div.card-value-bottom', { class: `suit-${card.suit}` }, [
        m('span', card.getDisplayValue()),
        m('span', card.getSymbol())
      ])
    ]));
  }
};

// Root Game View Component
const AppView = {
  oninit: () => {
    GameState.startNewGame();
  },
  view: () => {
    const southPlayer = GameState.players[0];
    const westPlayer = GameState.players[1];
    const northPlayer = GameState.players[2];
    const eastPlayer = GameState.players[3];

    const dir = GameState.getPassingDirection();

    return [
      // Circular Card Table
      m('div.card-table', [
        // NORTH PLAYER (AI)
        m('div.player-zone.zone-north', { class: GameState.turn === 2 ? 'active' : '' }, [
          m('div.player-name', [
            m('span', northPlayer.name),
            m('span.player-score', `Score: ${northPlayer.gameScore} (+${northPlayer.roundScore})`)
          ]),
          m('div.hand', northPlayer.hand.map((card, idx) =>
            m(CardComponent, { card, index: idx, total: northPlayer.hand.length, back: true })
          ))
        ]),

        // WEST PLAYER (AI)
        m('div.player-zone.zone-west', { class: GameState.turn === 1 ? 'active' : '' }, [
          m('div.player-name', [
            m('span', westPlayer.name),
            m('span.player-score', `Score: ${westPlayer.gameScore} (+${westPlayer.roundScore})`)
          ]),
          m('div.hand', westPlayer.hand.map((card, idx) =>
            m(CardComponent, { card, index: idx, total: westPlayer.hand.length, back: true })
          ))
        ]),

        // EAST PLAYER (AI)
        m('div.player-zone.zone-east', { class: GameState.turn === 3 ? 'active' : '' }, [
          m('div.player-name', [
            m('span', eastPlayer.name),
            m('span.player-score', `Score: ${eastPlayer.gameScore} (+${eastPlayer.roundScore})`)
          ]),
          m('div.hand', eastPlayer.hand.map((card, idx) =>
            m(CardComponent, { card, index: idx, total: eastPlayer.hand.length, back: true })
          ))
        ]),

        // CENTRAL TRICK BOARD
        m('div.center-board', [
          m('div.played-cards-container', {
            class: GameState.isCollecting ? `collect-to-${GameState.trickWinnerId === 0 ? 'south' : GameState.trickWinnerId === 1 ? 'west' : GameState.trickWinnerId === 2 ? 'north' : 'east'}` : ''
          }, GameState.currentTrick.map(play => {
            let slotClass = 'slot-';
            if (play.playerId === 0) slotClass += 'south';
            if (play.playerId === 1) slotClass += 'west';
            if (play.playerId === 2) slotClass += 'north';
            if (play.playerId === 3) slotClass += 'east';
            return m('div.played-card-slot', { class: slotClass },
              m(CardComponent, { card: play.card, back: false })
            );
          }))
        ]),

        // SOUTH PLAYER (USER)
        m('div.player-zone.zone-south', { class: GameState.turn === 0 ? 'active' : '' }, [
          m('div.hand.hand-fanned', southPlayer.hand.map((card, idx) => {
            const isSelected = southPlayer.selectedCards.some(c => c.id === card.id);
            const isPlayable = GameState.phase === PHASES.PLAYING &&
              GameState.turn === 0 &&
              !GameState.isAiWaiting &&
              GameState.isCardPlayable(southPlayer, card);

            return m(CardComponent, {
              card,
              index: idx,
              total: southPlayer.hand.length,
              back: false,
              selected: isSelected,
              playable: isPlayable,
              onclick: () => {
                if (GameState.phase === PHASES.PASSING) {
                  const selIdx = southPlayer.selectedCards.findIndex(c => c.id === card.id);
                  if (selIdx !== -1) {
                    southPlayer.selectedCards.splice(selIdx, 1);
                  } else if (southPlayer.selectedCards.length < 3) {
                    southPlayer.selectedCards.push(card);
                  }
                } else if (GameState.phase === PHASES.PLAYING && isPlayable) {
                  GameState.playCard(southPlayer, card);
                }
              }
            });
          })),
          m('div.player-name', { style: 'margin-top: 1rem;' }, [
            m('span', southPlayer.name),
            m('span.player-score', `Score: ${southPlayer.gameScore} (+${southPlayer.roundScore})`)
          ])
        ])
      ]),

      // Scoreboard HUD Bottom
      m('div.hud-panel', [
        m('div.hud-left', [
          m('h4', { style: 'margin:0 0 4px 0;' }, `Hearts Match - Round ${GameState.currentRound}`),
          m('span', { style: 'opacity: 0.7; font-size: 0.9rem;' },
            GameState.heartsBroken ? '💔 Hearts have been broken!' : '💚 Hearts are unbroken'
          )
        ]),
        m('div.hud-middle', [
          m('div.hud-message-text', GameState.messageText),
          GameState.phase === PHASES.PASSING && southPlayer.selectedCards.length < 3 &&
            m('span.hud-pass-counter', `Selected ${southPlayer.selectedCards.length} / 3 cards`),
          GameState.phase === PHASES.PASSING && southPlayer.selectedCards.length === 3 &&
            m('button.pass-btn', { onclick: () => GameState.executePassing() }, `Pass Cards ${dir}`),
          GameState.phase === PHASES.ROUND_OVER &&
            m('button.action-btn', { onclick: () => GameState.startNewRound() }, 'Start Next Round'),
          GameState.phase === PHASES.GAME_OVER &&
            m('button.action-btn', { onclick: () => GameState.startNewGame() }, 'New Game')
        ]),
        m('div.hud-right', [
          m('div.direction-indicator', [
            m('span', `Passing: `),
            m('strong', dir === PASSING_DIRECTIONS.NONE ? 'None (Hold Hand)' : dir)
          ]),
          m('button.action-btn', {
            style: 'margin-left: 1rem; background: #475569;',
            onclick: () => GameState.startNewGame()
          }, 'Restart Match')
        ])
      ])
    ];
  }
};

// Mount the application
m.mount(document.getElementById('app-container'), AppView);
