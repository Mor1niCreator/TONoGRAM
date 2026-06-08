import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { fileURLToPath } from 'url';
import path from 'path';
import { GameRoom } from './server/GameRoom.js'; // Assuming we're using ESM

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

const server = createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  transports: ['websocket']
});

const isProd = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;

// In-memory state for game and matchmaking
const waitingPlayers: Array<{socketId: string, name: string}> = [];
const activeRooms: Map<string, GameRoom> = new Map();

interface LeaderboardEntry {
  name: string;
  wins: number;
}
let leaderboard: LeaderboardEntry[] = [];

// API for Leaderboard
app.get('/api/leaderboard', (req, res) => {
  res.json(leaderboard.slice(0, 10)); // Top 10
});

async function bootstrap() {
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist/index.html'));
    });
  }

  // Socket.io logic
  io.on('connection', (socket) => {
    console.log('socket connected:', socket.id);
    let currentRoomId: string | null = null;
    let playerName: string = 'Anonymous';
    
    socket.on('find_match', (name: string) => {
      playerName = name || 'Anonymous';
      
      // Remove player from queue if they are already in it to prevent duplicates/self-match
      const existingIdx = waitingPlayers.findIndex(p => p.socketId === socket.id);
      if (existingIdx !== -1) {
        waitingPlayers.splice(existingIdx, 1);
      }

      if (waitingPlayers.length > 0) {
        const opponent = waitingPlayers.pop()!;
        if (opponent.socketId === socket.id) {
          waitingPlayers.push(opponent);
          return; // Prevent matching self
        }
        const roomId = `room_${Math.random().toString(36).substring(7)}`;
        
        const p1Id = socket.id;
        const p1Name = playerName;
        const p2Id = opponent.socketId;
        const p2Name = opponent.name;
        
        socket.join(roomId);
        const opponentSocket = io.sockets.sockets.get(p2Id);
        if (opponentSocket) {
          opponentSocket.join(roomId);
        }
        
        currentRoomId = roomId;

        const gameRoom = new GameRoom(roomId, p1Id, p2Id, {
          onStateUpdate: (state: any) => {
            io.to(roomId).emit('game_state', state);
          },
          onGoal: (playerIndex: number) => {
            io.to(roomId).emit('goal_scored', playerIndex);
          },
          onGameOver: (winner: number) => {
            const winnerName = winner === 1 ? p1Name : p2Name;
            
            // update leaderboard
            const lbEntry = leaderboard.find(l => l.name === winnerName);
            if (lbEntry) lbEntry.wins += 1;
            else leaderboard.push({ name: winnerName, wins: 1 });
            leaderboard.sort((a, b) => b.wins - a.wins);

            io.to(roomId).emit('game_over', { winnerIndex: winner, winnerName });
            gameRoom.stop();
            activeRooms.delete(roomId);

            // Clean up rooms
            socket.leave(roomId);
            if (opponentSocket) {
              opponentSocket.leave(roomId);
            }
          }
        });

        activeRooms.set(roomId, gameRoom);
        gameRoom.start();

        io.to(p1Id).emit('match_found', { role: 'p1', opponentName: p2Name, roomId });
        io.to(p2Id).emit('match_found', { role: 'p2', opponentName: p1Name, roomId });
        
      } else {
        waitingPlayers.push({ socketId: socket.id, name: playerName });
        socket.emit('waiting_for_match');
      }
    });

    socket.on('leave_queue', () => {
      const waitIdx = waitingPlayers.findIndex(p => p.socketId === socket.id);
      if (waitIdx !== -1) {
        waitingPlayers.splice(waitIdx, 1);
      }
    });

    socket.on('player_input', (data: { x: number, y: number }) => {
      if (!currentRoomId) return;
      const room = activeRooms.get(currentRoomId);
      if (room) {
        room.applyInput(socket.id, data.x, data.y);
      }
    });
    
    socket.on('disconnect', () => {
      console.log('socket disconnected:', socket.id);
      const waitIdx = waitingPlayers.findIndex(p => p.socketId === socket.id);
      if (waitIdx !== -1) waitingPlayers.splice(waitIdx, 1);
      
      if (currentRoomId) {
        const room = activeRooms.get(currentRoomId);
        if (room) {
          room.stop();
          activeRooms.delete(currentRoomId);
          io.to(currentRoomId).emit('opponent_disconnected');
          
          socket.leave(currentRoomId);
          const otherSocketId = socket.id === room.p1Id ? room.p2Id : room.p1Id;
          const otherSocket = io.sockets.sockets.get(otherSocketId);
          if (otherSocket) {
            otherSocket.leave(currentRoomId);
          }
        }
      }
    });
  });

  server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

bootstrap();
