import { useState, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import GameCanvas from './GameCanvas';
import { Trophy, Play, Settings, X, Loader2, Sparkles } from 'lucide-react';

let socket: Socket;

export default function App() {
  const [phase, setPhase] = useState<'menu' | 'waiting' | 'playing'>('menu');
  const [playerName, setPlayerName] = useState('');
  const [role, setRole] = useState<'p1' | 'p2'>('p1');
  const [opponentName, setOpponentName] = useState('');
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [leaderboard, setLeaderboard] = useState<{name: string, wins: number}[]>([]);

  useEffect(() => {
    // Only fetch leaderboard on mount/menu
    fetchLeaderboard();
    
    // Connect socket
    socket = io({
      transports: ['websocket']
    });

    socket.on('waiting_for_match', () => {
      setPhase('waiting');
    });

    socket.on('match_found', (data) => {
      setRole(data.role);
      setOpponentName(data.opponentName);
      setPhase('playing');
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const fetchLeaderboard = async () => {
    try {
      const res = await fetch('/api/leaderboard');
      const data = await res.json();
      setLeaderboard(data);
    } catch(e) {
      console.error(e);
    }
  };

  const handlePlay = () => {
    const name = playerName.trim() || `Player_${Math.floor(Math.random() * 1000)}`;
    setPlayerName(name);
    socket.emit('find_match', name);
  };

  const openLeaderboard = () => {
    fetchLeaderboard();
    setShowLeaderboard(true);
  };

  return (
    <div className="min-h-[100dvh] bg-slate-950 flex items-center justify-center font-sans overflow-hidden sm:p-4">
      {/* Phone Constrained Canvas Area */}
      <div className="relative w-full h-[100dvh] sm:h-[800px] sm:max-w-[450px] bg-slate-900 sm:rounded-[2.5rem] shadow-2xl sm:border-[8px] border-slate-800 overflow-hidden flex flex-col">
        
        {phase === 'menu' && (
          <div className="flex-1 flex flex-col items-center justify-center p-8 relative">
            <div className="absolute top-0 inset-x-0 h-1/2 bg-gradient-to-b from-blue-500/10 to-transparent pointer-events-none" />
            
            <div className="mb-12 text-center relative">
              <div className="absolute -inset-4 bg-blue-500/20 blur-2xl rounded-full" />
              <Sparkles className="w-8 h-8 text-blue-400 absolute -top-6 -right-4 animate-pulse" />
              <h1 className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-br from-blue-400 to-indigo-600 tracking-tighter drop-shadow-sm mb-2">
                AERO
              </h1>
              <h1 className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-br from-rose-400 to-red-600 tracking-tighter drop-shadow-sm">
                STRIKE
              </h1>
            </div>

            <div className="w-full space-y-6 relative z-10">
              <div>
                <label className="block text-slate-400 text-sm font-bold mb-2 ml-2 uppercase tracking-wide">Callsign</label>
                <input 
                  type="text" 
                  maxLength={12}
                  placeholder="Enter Name"
                  value={playerName}
                  onChange={e => setPlayerName(e.target.value)}
                  className="w-full bg-slate-800/50 border-2 border-slate-700 rounded-2xl px-6 py-4 text-xl text-white font-bold placeholder-slate-600 focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/20 transition-all text-center"
                />
              </div>

              <button 
                onClick={handlePlay}
                className="w-full bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 text-white font-black text-xl py-5 px-6 rounded-2xl transition-all active:scale-95 shadow-[0_0_40px_rgba(59,130,246,0.3)] flex items-center justify-center gap-3 border border-blue-400/30"
              >
                <Play className="fill-current w-6 h-6" />
                FIND MATCH
              </button>
            </div>

            {/* Bottom Floating Menu Bar (Hides/Shows) */}
            <div className="absolute bottom-8 left-8 right-8 flex gap-4">
              <button 
                onClick={openLeaderboard}
                className="flex-1 bg-slate-800 hover:bg-slate-700 text-white font-bold py-4 rounded-xl transition-all flex flex-col items-center gap-1 border-2 border-slate-700 active:scale-95"
              >
                <Trophy className="w-6 h-6 text-yellow-500" />
                <span className="text-xs uppercase tracking-wider text-slate-400">Rankings</span>
              </button>
              <button 
                className="flex-1 bg-slate-800 hover:bg-slate-700 text-white font-bold py-4 rounded-xl transition-all flex flex-col items-center gap-1 border-2 border-slate-700 active:scale-95 opacity-50 cursor-not-allowed"
              >
                <Settings className="w-6 h-6 text-slate-400" />
                <span className="text-xs uppercase tracking-wider text-slate-400">Settings</span>
              </button>
            </div>
          </div>
        )}

        {phase === 'waiting' && (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <Loader2 className="w-16 h-16 text-blue-500 animate-spin mb-8" />
            <h2 className="text-3xl font-black text-white mb-2">Searching...</h2>
            <p className="text-slate-400 font-medium">Waiting for an opponent to join</p>
            <button 
               onClick={() => {
                 socket.emit('leave_queue'); // Not fully implemented on server, but safe
                 socket.disconnect();
                 socket.connect();
                 setPhase('menu');
               }}
               className="mt-12 text-rose-400 font-bold px-6 py-3 rounded-full hover:bg-rose-500/10 transition-colors"
            >
              Cancel
            </button>
          </div>
        )}

        {phase === 'playing' && (
          <GameCanvas 
            socket={socket} 
            role={role} 
            opponentName={opponentName} 
            onLeave={() => {
              setPhase('menu');
              fetchLeaderboard();
            }} 
          />
        )}

        {/* Leaderboard Drawer/Modal */}
        {showLeaderboard && (
          <div className="absolute inset-0 z-50 flex flex-col justify-end pointer-events-none">
            <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm pointer-events-auto transition-opacity" onClick={() => setShowLeaderboard(false)} />
            <div className="bg-slate-800 rounded-t-3xl border-t-2 border-slate-700 p-6 pointer-events-auto relative shadow-[0_-20px_50px_rgba(0,0,0,0.5)] h-[70%] flex flex-col animate-in slide-in-from-bottom duration-300">
              <div className="w-12 h-1.5 bg-slate-600 rounded-full w-full mx-auto mb-6 opacity-50" />
              <button 
                onClick={() => setShowLeaderboard(false)}
                className="absolute top-6 right-6 p-2 bg-slate-700/50 rounded-full hover:bg-slate-700 text-slate-300"
              >
                <X className="w-5 h-5" />
              </button>
              
              <div className="flex items-center gap-3 mb-6 px-2">
                <Trophy className="w-8 h-8 text-yellow-400" />
                <h2 className="text-2xl font-black text-white">Global Top 10</h2>
              </div>
              
              <div className="flex-1 overflow-y-auto pr-2 space-y-3 custom-scrollbar">
                {leaderboard.length === 0 ? (
                  <p className="text-slate-500 text-center mt-10 font-medium">No games recorded yet.</p>
                ) : (
                  leaderboard.map((lb, i) => (
                    <div key={i} className="flex items-center justify-between bg-slate-900/50 border border-slate-700/50 p-4 rounded-2xl">
                      <div className="flex items-center gap-4">
                        <span className={`font-black text-lg w-6 text-center ${i === 0 ? 'text-yellow-400' : i === 1 ? 'text-slate-300' : i === 2 ? 'text-amber-600' : 'text-slate-600'}`}>
                          #{i + 1}
                        </span>
                        <span className="font-bold text-slate-200">{lb.name}</span>
                      </div>
                      <div className="bg-blue-500/20 text-blue-400 font-black px-3 py-1 rounded-lg">
                        {lb.wins}W
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
        
      </div>
    </div>
  );
}
