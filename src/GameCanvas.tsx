import React, { useEffect, useRef, useState } from 'react';
import { Socket } from 'socket.io-client';
import { GAME_WIDTH, GAME_HEIGHT, GOAL_WIDTH, PUCK_RADIUS, MALLET_RADIUS } from '../shared/constants.js';
import { Trophy, Home } from 'lucide-react';

interface GameCanvasProps {
  socket: Socket;
  role: 'p1' | 'p2';
  opponentName: string;
  onLeave: () => void;
}

export default function GameCanvas({ socket, role, opponentName, onLeave }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [score, setScore] = useState({ p1: 0, p2: 0 });
  const [gameOver, setGameOver] = useState<{ winnerScore: number, winnerName: string } | null>(null);

  const stateRef = useRef<any>(null);
  const stateBuffer = useRef<Array<{ timestamp: number, state: any }>>([]);
  
  // Local mallet predicted position
  const localMalletPos = useRef<{ x: number, y: number }>({
    x: GAME_WIDTH / 2,
    y: role === 'p1' ? GAME_HEIGHT - 100 : 100
  });

  // Networking optimization: throttle input sending
  const lastEmitTime = useRef<number>(0);
  const trailingTimeout = useRef<any>(null);

  useEffect(() => {
    socket.on('game_state', (state) => {
      stateRef.current = state;
      setScore(state.score);
      
      stateBuffer.current.push({
        timestamp: Date.now(),
        state: state
      });
      
      if (stateBuffer.current.length > 60) {
        stateBuffer.current.shift();
      }
    });

    socket.on('game_over', (data) => {
      setGameOver({ 
        winnerScore: data.winnerIndex === 1 ? stateRef.current?.score.p1 : stateRef.current?.score.p2, 
        winnerName: data.winnerName 
      });
    });

    socket.on('opponent_disconnected', () => {
      setGameOver({ winnerScore: 7, winnerName: 'You (Opponent left)' });
    });

    return () => {
      socket.off('game_state');
      socket.off('game_over');
      socket.off('opponent_disconnected');
      if (trailingTimeout.current) {
        clearTimeout(trailingTimeout.current);
      }
    };
  }, [socket]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;

    const render = () => {
      ctx.clearRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

      // 1. Draw Premium Air Hockey Table background with depth gradient
      const bgGrad = ctx.createRadialGradient(
        GAME_WIDTH / 2, GAME_HEIGHT / 2, 50, 
        GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_HEIGHT / 2
      );
      bgGrad.addColorStop(0, '#0f172a'); // Slate 900
      bgGrad.addColorStop(1, '#020617'); // Slate 950
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

      // 2. Draw Table Lines
      ctx.beginPath();
      ctx.moveTo(0, GAME_HEIGHT / 2);
      ctx.lineTo(GAME_WIDTH, GAME_HEIGHT / 2);
      ctx.strokeStyle = 'rgba(51, 65, 85, 0.5)';
      ctx.lineWidth = 4;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(GAME_WIDTH / 2, GAME_HEIGHT / 2, 80, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(51, 65, 85, 0.4)';
      ctx.lineWidth = 3;
      ctx.stroke();

      // 3. Draw Goals with neon gradient glows (high performance, zero CPU shadow overhead)
      const topGoalGlow = ctx.createLinearGradient(0, 0, 0, 35);
      topGoalGlow.addColorStop(0, 'rgba(239, 68, 68, 0.6)');
      topGoalGlow.addColorStop(1, 'rgba(239, 68, 68, 0)');
      ctx.fillStyle = topGoalGlow;
      ctx.fillRect((GAME_WIDTH - GOAL_WIDTH) / 2, 0, GOAL_WIDTH, 35);
      ctx.fillStyle = '#ef4444';
      ctx.fillRect((GAME_WIDTH - GOAL_WIDTH) / 2, 0, GOAL_WIDTH, 8);

      const botGoalGlow = ctx.createLinearGradient(0, GAME_HEIGHT, 0, GAME_HEIGHT - 35);
      botGoalGlow.addColorStop(0, 'rgba(59, 130, 246, 0.6)');
      botGoalGlow.addColorStop(1, 'rgba(59, 130, 246, 0)');
      ctx.fillStyle = botGoalGlow;
      ctx.fillRect((GAME_WIDTH - GOAL_WIDTH) / 2, GAME_HEIGHT - 35, GOAL_WIDTH, 35);
      ctx.fillStyle = '#3b82f6';
      ctx.fillRect((GAME_WIDTH - GOAL_WIDTH) / 2, GAME_HEIGHT - 8, GOAL_WIDTH, 8);

      const state = stateRef.current;
      if (state) {
        const transformX = (x: number) => role === 'p2' ? GAME_WIDTH - x : x;
        const transformY = (y: number) => role === 'p2' ? GAME_HEIGHT - y : y;

        // --- Client-Side Interpolation Calculation ---
        const renderTime = Date.now() - 100;
        let interpolatedPuck = { x: state.puck.x, y: state.puck.y };
        let interpolatedP1 = { x: state.p1.x, y: state.p1.y, radius: state.p1.radius || MALLET_RADIUS };
        let interpolatedP2 = { x: state.p2.x, y: state.p2.y, radius: state.p2.radius || MALLET_RADIUS };
        
        const buffer = stateBuffer.current;
        if (buffer.length >= 2) {
          let i = 0;
          for (; i < buffer.length - 1; i++) {
            if (buffer[i].timestamp <= renderTime && buffer[i+1].timestamp >= renderTime) {
              break;
            }
          }
          
          if (i < buffer.length - 1) {
            const s0 = buffer[i];
            const s1 = buffer[i+1];
            const ratio = (renderTime - s0.timestamp) / (s1.timestamp - s0.timestamp);
            
            interpolatedPuck.x = s0.state.puck.x + (s1.state.puck.x - s0.state.puck.x) * ratio;
            interpolatedPuck.y = s0.state.puck.y + (s1.state.puck.y - s0.state.puck.y) * ratio;
            
            interpolatedP1.x = s0.state.p1.x + (s1.state.p1.x - s0.state.p1.x) * ratio;
            interpolatedP1.y = s0.state.p1.y + (s1.state.p1.y - s0.state.p1.y) * ratio;
            interpolatedP1.radius = s0.state.p1.radius || MALLET_RADIUS;
            
            interpolatedP2.x = s0.state.p2.x + (s1.state.p2.x - s0.state.p2.x) * ratio;
            interpolatedP2.y = s0.state.p2.y + (s1.state.p2.y - s0.state.p2.y) * ratio;
            interpolatedP2.radius = s0.state.p2.radius || MALLET_RADIUS;
          } else {
            const latest = buffer[buffer.length - 1].state;
            interpolatedPuck = { x: latest.puck.x, y: latest.puck.y };
            interpolatedP1 = { x: latest.p1.x, y: latest.p1.y, radius: latest.p1.radius || MALLET_RADIUS };
            interpolatedP2 = { x: latest.p2.x, y: latest.p2.y, radius: latest.p2.radius || MALLET_RADIUS };
          }
        }

        // Draw Powerups
        state.powerups.forEach((p: any) => {
          const px = transformX(p.x);
          const py = transformY(p.y);
          ctx.beginPath();
          ctx.arc(px, py, 20, 0, Math.PI * 2);
          ctx.fillStyle = p.type === 'BIG_MALLET' ? '#f59e0b' : '#10b981';
          ctx.fill();
          ctx.lineWidth = 3;
          ctx.strokeStyle = '#fff';
          ctx.stroke();
          
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 16px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(p.type === 'BIG_MALLET' ? '🔨' : '⚡', px, py);
        });

        // Draw Puck (Interpolated with premium metallic radial gradient)
        const puckX = transformX(interpolatedPuck.x);
        const puckY = transformY(interpolatedPuck.y);
        ctx.beginPath();
        ctx.arc(puckX, puckY, PUCK_RADIUS, 0, Math.PI * 2);
        const puckGrad = ctx.createRadialGradient(puckX, puckY, 0, puckX, puckY, PUCK_RADIUS);
        puckGrad.addColorStop(0, '#fffbeb');
        puckGrad.addColorStop(0.3, '#fbbf24');
        puckGrad.addColorStop(1, '#d97706');
        ctx.fillStyle = puckGrad;
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();

        // Get mallet positions.
        // For local player: use predicted local position for zero-latency response.
        // For opponent: use interpolated server position.
        const currentP1X = role === 'p1' ? localMalletPos.current.x : interpolatedP1.x;
        const currentP1Y = role === 'p1' ? localMalletPos.current.y : interpolatedP1.y;
        const currentP2X = role === 'p2' ? localMalletPos.current.x : interpolatedP2.x;
        const currentP2Y = role === 'p2' ? localMalletPos.current.y : interpolatedP2.y;

        // Perform server discrepancy verification & LERP correction to solve collisions/glitches
        const serverMallet = role === 'p1' ? interpolatedP1 : interpolatedP2;
        const dx = localMalletPos.current.x - serverMallet.x;
        const dy = localMalletPos.current.y - serverMallet.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 15) {
          localMalletPos.current.x += (serverMallet.x - localMalletPos.current.x) * 0.15;
          localMalletPos.current.y += (serverMallet.y - localMalletPos.current.y) * 0.15;
        }

        // Draw P1 (Blue - gradient styled)
        const p1X = transformX(currentP1X);
        const p1Y = transformY(currentP1Y);
        ctx.beginPath();
        ctx.arc(p1X, p1Y, interpolatedP1.radius, 0, Math.PI * 2);
        const p1Grad = ctx.createRadialGradient(p1X, p1Y, 0, p1X, p1Y, interpolatedP1.radius);
        p1Grad.addColorStop(0, '#93c5fd');
        p1Grad.addColorStop(0.7, role === 'p1' ? '#3b82f6' : '#2563eb');
        p1Grad.addColorStop(1, '#1d4ed8');
        ctx.fillStyle = p1Grad;
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
        
        ctx.beginPath();
        ctx.arc(p1X, p1Y, interpolatedP1.radius * 0.4, 0, Math.PI * 2);
        ctx.fillStyle = '#1e3a8a';
        ctx.fill();
        ctx.stroke();

        // Draw P2 (Red - gradient styled)
        const p2X = transformX(currentP2X);
        const p2Y = transformY(currentP2Y);
        ctx.beginPath();
        ctx.arc(p2X, p2Y, interpolatedP2.radius, 0, Math.PI * 2);
        const p2Grad = ctx.createRadialGradient(p2X, p2Y, 0, p2X, p2Y, interpolatedP2.radius);
        p2Grad.addColorStop(0, '#fca5a5');
        p2Grad.addColorStop(0.7, role === 'p2' ? '#ef4444' : '#dc2626');
        p2Grad.addColorStop(1, '#b91c1c');
        ctx.fillStyle = p2Grad;
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
        
        ctx.beginPath();
        ctx.arc(p2X, p2Y, interpolatedP2.radius * 0.4, 0, Math.PI * 2);
        ctx.fillStyle = '#7f1d1d';
        ctx.fill();
        ctx.stroke();
      }

      animationId = requestAnimationFrame(render);
    };

    render();

    return () => cancelAnimationFrame(animationId);
  }, [role]);

  // Handle Input with local prediction update & boundaries logic
  const handleInput = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = GAME_WIDTH / rect.width;
    const scaleY = GAME_HEIGHT / rect.height;

    const rawX = (clientX - rect.left) * scaleX;
    const rawY = (clientY - rect.top) * scaleY;

    const logicalX = role === 'p2' ? GAME_WIDTH - rawX : rawX;
    const logicalY = role === 'p2' ? GAME_HEIGHT - rawY : rawY;

    // Use current mallet radius from state to dynamically update boundaries
    const activeRadius = (role === 'p1' ? stateRef.current?.p1.radius : stateRef.current?.p2.radius) || MALLET_RADIUS;
    
    let predictedY = logicalY;
    if (role === 'p1') {
      predictedY = Math.max(GAME_HEIGHT / 2 + activeRadius, Math.min(GAME_HEIGHT - activeRadius, logicalY));
    } else {
      predictedY = Math.max(activeRadius, Math.min(GAME_HEIGHT / 2 - activeRadius, logicalY));
    }
    const predictedX = Math.max(activeRadius, Math.min(GAME_WIDTH - activeRadius, logicalX));

    // Instantly update client prediction
    localMalletPos.current = { x: predictedX, y: predictedY };

    // Optimize network: Throttle Socket.IO outbound coordinate updates to max ~60Hz
    const now = Date.now();
    if (trailingTimeout.current) {
      clearTimeout(trailingTimeout.current);
      trailingTimeout.current = null;
    }

    if (now - lastEmitTime.current >= 16) {
      socket.emit('player_input', { x: predictedX, y: predictedY });
      lastEmitTime.current = now;
    } else {
      trailingTimeout.current = setTimeout(() => {
        socket.emit('player_input', { x: predictedX, y: predictedY });
        lastEmitTime.current = Date.now();
      }, 16);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    handleInput(e.clientX, e.clientY);
  };

  const onTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (e.touches.length > 0) {
      handleInput(e.touches[0].clientX, e.touches[0].clientY);
    }
  };

  const myScore = role === 'p1' ? score.p1 : score.p2;
  const oppScore = role === 'p1' ? score.p2 : score.p1;

  return (
    <div className="relative w-full h-full flex flex-col bg-slate-900 rounded-3xl overflow-hidden shadow-2xl border-4 border-slate-700">
      
      {/* Score Header */}
      <div className="absolute top-4 left-0 right-0 flex justify-between px-6 pointer-events-none z-10">
        <div className="flex flex-col items-center">
          <span className="text-slate-400 font-bold text-sm uppercase tracking-widest">{opponentName}</span>
          <span className="text-4xl font-black text-rose-500 drop-shadow-md">{oppScore}</span>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-slate-400 font-bold text-sm uppercase tracking-widest">YOU</span>
          <span className="text-4xl font-black text-blue-500 drop-shadow-md">{myScore}</span>
        </div>
      </div>

      <canvas 
        ref={canvasRef}
        width={GAME_WIDTH}
        height={GAME_HEIGHT}
        className="w-full h-full object-contain touch-none cursor-crosshair pb-12"
        onPointerMove={onPointerMove}
        onTouchMove={onTouchMove}
      />

      {gameOver && (
        <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center z-20">
          <div className="bg-slate-800 p-8 rounded-3xl shadow-2xl border-4 border-slate-700 max-w-[80%] text-center transform scale-100 transition-all">
            <Trophy className="w-16 h-16 text-yellow-400 mx-auto mb-4" />
            <h2 className="text-3xl font-black text-white mb-2">{gameOver.winnerName} Wins!</h2>
            <p className="text-slate-400 mb-6 font-medium">GG Well Played</p>
            <button 
              onClick={onLeave}
              className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-4 px-6 rounded-2xl transition-all shadow-lg shadow-blue-500/20 active:scale-95 flex items-center justify-center gap-2"
            >
              <Home className="w-5 h-5" />
              Return to Menu
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
