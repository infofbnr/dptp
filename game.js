import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  onSnapshot,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

// Your Firebase config
const firebaseConfig = {
  apiKey: "AIzaSyCHYnW3qaNo7oGKMPs9DFALdWXIeYv6ixY",
  authDomain: "gossip-38bf8.firebaseapp.com",
  projectId: "gossip-38bf8",
  storageBucket: "gossip-38bf8.firebasestorage.app",
  messagingSenderId: "224975261462",
  appId: "1:224975261462:web:f08fd243ec4a5c1a4a4a37",
  measurementId: "G-N7S9894R3N"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const createRoomBtn = document.getElementById("createRoom");
const joinRoomBtn = document.getElementById("joinRoom");
const playerNameInput = document.getElementById("playerName");
const roomCodeInput = document.getElementById("roomCodeInput");

const welcomeScreen = document.getElementById("welcomeScreen");
const gameScreen = document.getElementById("gameScreen");
const turnDisplay = document.getElementById("turnDisplay");
const mmGrid = document.getElementById("mmGrid");


let roomCode = null;
let playerRole = null; // "P1" or "P2"
let gameDataUnsubscribe = null;

let player2Name = null;
let player1Name = null;


createRoomBtn.addEventListener("click", async () => {
    player1Name = playerNameInput.value.trim();
  if (!player1Name) {
    alert("Please enter your name");
    return;
  }

  // Generate 5-letter room code (you can customize)
  roomCode = generateRoomCode();

  // Create game doc in Firestore with initial state
  await setDoc(doc(db, "games", roomCode), {
    players: {
      P1: player1Name,
      P2: null
    },
    poisonedByP1: null,
    poisonedByP2: null,
    currentTurn: null,
    eaten: [],
    gameOver: false,
    winnerMessage: ""
  });

  playerRole = "P1";

  showGameScreen();

  turnDisplay.textContent = `Waiting for other player to join... (Room Code: ${roomCode})`;

  // Listen for changes to the room (especially for Player 2 joining)
  gameDataUnsubscribe = onSnapshot(doc(db, "games", roomCode), (docSnap) => {
    if (!docSnap.exists()) return;

    const data = docSnap.data();

    // Detect when Player 2 joins
    if (playerRole === "P1" && data.players.P2) {
      turnDisplay.textContent = `Player 2 (${data.players.P2}) joined! Starting game...`;
      startGame(data);
    }

    // Detect if game updated while waiting
    if (data.gameOver) {
      endGame(data.winnerMessage);
    }
  });
});

joinRoomBtn.addEventListener("click", async () => {
    player2Name = playerNameInput.value.trim();
  if (!player2Name) {
    alert("Please enter your name");
    return;
  }

  roomCode = roomCodeInput.value.trim().toUpperCase();
  if (!roomCode || roomCode.length !== 5) {
    alert("Please enter a valid 5-letter room code");
    return;
  }

  const gameDocRef = doc(db, "games", roomCode);
  const gameSnap = await getDoc(gameDocRef);
  if (!gameSnap.exists()) {
    alert("Room not found");
    return;
  }

  const data = gameSnap.data();

  if (data.players.P2) {
    alert("Room is full");
    return;
  }

  // Update room with Player 2's name
  await updateDoc(gameDocRef, {
    "players.P2": player2Name
  });

  playerRole = "P2";

  showGameScreen();

  turnDisplay.textContent = `Joined room! Waiting for the host to start...`;

  // Listen for realtime updates
  gameDataUnsubscribe = onSnapshot(gameDocRef, (docSnap) => {
    if (!docSnap.exists()) return;

    const data = docSnap.data();

    if (data.gameOver) {
      endGame(data.winnerMessage);
    }

    // Once both players have poisoned M&Ms chosen, start the turns
    if (data.poisonedByP1 !== null && data.poisonedByP2 !== null && data.currentTurn) {
      updateGameUI(data);
    }
  });
});

// Utility to generate a 5-letter room code (random uppercase letters)
function generateRoomCode() {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += letters.charAt(Math.floor(Math.random() * letters.length));
  }
  return code;
}

// Show game screen and hide welcome
function showGameScreen() {
  welcomeScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");
  initializeMMGrid();
}

// Initialize the M&M grid UI (24 colored circles)
function initializeMMGrid() {
  mmGrid.innerHTML = "";
  const mmColors = [
    "bg-red-600", "bg-yellow-400", "bg-green-500",
    "bg-blue-500", "bg-purple-600", "bg-orange-400"
  ];

  for (let i = 0; i < 25; i++) {
    const mm = document.createElement("div");
    const randomColor = mmColors[Math.floor(Math.random() * mmColors.length)];
    mm.className = `mm w-14 h-14 rounded-full flex items-center justify-center font-bold text-xl cursor-pointer shadow-inner shadow-black transition-transform duration-150 hover:scale-110 ${randomColor}`;
    mm.textContent = "m";
    mm.dataset.index = i;
    mm.addEventListener("click", () => handleClick(i));
    mmGrid.appendChild(mm);
  }
}

// Game logic state variables
let poisonedByP1 = null;
let poisonedByP2 = null;
let currentTurn = null;
let eaten = [];
let gameOver = false;


async function handleClick(index) {
  if (gameOver) return;

  // Poisoned M&Ms picking phase
  if (playerRole === "P1" && poisonedByP1 === null) {
    poisonedByP1 = index;
    await updateGameField("poisonedByP1", index);
    turnDisplay.textContent = `Waiting for Player 2 to choose poisoned M&M...`;
    return;
  }

  if (playerRole === "P2" && poisonedByP2 === null) {
    poisonedByP2 = index;
    await updateGameField("poisonedByP2", index);
    // Set current turn to Player 1 to start eating
    await updateGameField("currentTurn", "P1");
    return;
  }

  // Eating phase
  if (currentTurn !== playerRole) {
    turnDisplay.textContent = "Wait for your turn!";
    return;
  }

  if (eaten.includes(index)) {
    turnDisplay.textContent = "Already eaten! Pick another M&M.";
    return;
  }

  eaten.push(index);
  await updateGameField("eaten", eaten);

  // Check if poisoned M&M eaten — lose scenario
  if (
    (playerRole === "P1" && (index === poisonedByP2 || index === poisonedByP1)) ||
    (playerRole === "P2" && (index === poisonedByP1 || index === poisonedByP2))
  ) {
    // Determine winnerRole and message for generic WIN/LOSS display
    let winnerRole;
    let message;

    if (
      (playerRole === "P1" && index === poisonedByP2) ||
      (playerRole === "P2" && index === poisonedByP1)
    ) {
      // Ate opponent's poisoned M&M → current player loses
      winnerRole = playerRole === "P1" ? "P2" : "P1";
      message = "💀 Player lost by eating opponent's poisoned M&M.";
    } else {
      // Ate own poisoned M&M → current player loses
      winnerRole = playerRole === "P1" ? "P2" : "P1";
      message = "☠️ Player lost by eating their own poisoned M&M.";
    }

    await endGameFirestore(message, winnerRole);
    return;
  }

  // Check draw: only 2 M&Ms left (both poisoned)
  if (eaten.length === 23) {
    const message = "🤝 Draw! Only poisoned M&Ms remain.";
    await endGameFirestore(message, null); // null means no winner
    return;
  }

  // Switch turn
  currentTurn = currentTurn === "P1" ? "P2" : "P1";
  await updateGameField("currentTurn", currentTurn);
  turnDisplay.textContent = "Opponent's turn";
}



// Update a single field in Firestore game document
async function updateGameField(field, value) {
  const gameDocRef = doc(db, "games", roomCode);
  await updateDoc(gameDocRef, { [field]: value });
}

// Start the game locally with data from Firestore
function startGame(data) {
  poisonedByP1 = data.poisonedByP1;
  poisonedByP2 = data.poisonedByP2;
  currentTurn = data.currentTurn;
  eaten = data.eaten;
  gameOver = data.gameOver;

  updateGameUI(data);
}

// Update UI based on game state
function updateGameUI(data) {
  const mmElements = document.querySelectorAll(".mm");
  
  poisonedByP1 = data.poisonedByP1;
  poisonedByP2 = data.poisonedByP2;
  currentTurn = data.currentTurn;
  eaten = data.eaten || [];
  gameOver = data.gameOver;

  // Update M&M UI: mark eaten
  mmElements.forEach(mm => {
    const idx = parseInt(mm.dataset.index);
    if (eaten.includes(idx)) {
      mm.classList.add("eaten", "opacity-30", "scale-90");
      mm.style.pointerEvents = "none";
    } else {
      mm.classList.remove("eaten", "opacity-30", "scale-90");
      mm.style.pointerEvents = "auto";
    }
  });

  // If game over, highlight poisoned M&Ms and disable clicks
  if (gameOver) {
    mmElements.forEach(mm => (mm.style.pointerEvents = "none"));
    mmElements[poisonedByP1]?.classList.add("ring", "ring-blue-400", "ring-4");
    mmElements[poisonedByP2]?.classList.add("ring", "ring-green-400", "ring-4");
    turnDisplay.textContent = data.winnerMessage || "Game Over!";
    return;
  }

  // Determine and show message based on phase and turn

  if (playerRole === "P1" && poisonedByP1 === null) {
    turnDisplay.textContent = "Your turn: Choose your poisoned M&M";
    return;
  }

  if (playerRole === "P2" && poisonedByP2 === null) {
    turnDisplay.textContent = "Your turn: Choose your poisoned M&M";
    return;
  }

  // Both poisoned M&Ms picked, now eating phase
  if (currentTurn === playerRole) {
    turnDisplay.textContent = "Your turn: Eat an M&M!";
  } else {
    turnDisplay.textContent = "Opponent's turn";
    // Disable clicking if it's opponent's turn
    mmElements.forEach(mm => (mm.style.pointerEvents = "none"));
  }
}

async function endGameFirestore(message, winnerRole) {
  // Update Firestore with game over and winner
  await updateGameField("gameOver", true);
  await updateGameField("winnerRole", winnerRole);
  await updateGameField("winnerMessage", message);

  // Call local endGame to update UI
  endGame(message, winnerRole);
}

function endGame(message, winnerRole = null) {
  gameOver = true;
  turnDisplay.textContent = "";

  // Disable all M&M clicks
  const mmElements = document.querySelectorAll(".mm");
  mmElements.forEach((mm) => (mm.style.pointerEvents = "none"));

  const player1Status = document.getElementById("player1Status");
  const player2Status = document.getElementById("player2Status");
  const winnerText = document.getElementById("winnerText");
  const winnerScreen = document.getElementById("winnerScreen");

  // Clear previous status & classes
  if (player1Status && player2Status) {
    player1Status.textContent = "";
    player2Status.textContent = "";
    player1Status.className = "status-label";
    player2Status.className = "status-label";
  }

  if (winnerText) {
    winnerText.textContent = "";
  }

  if (winnerRole !== null && winnerScreen) {
    if (winnerRole === "P1") {
      player1Status.textContent = "WIN";
      player1Status.classList.add("status-win");
      player2Status.textContent = "LOSS";
      player2Status.classList.add("status-loss");
    } else if (winnerRole === "P2") {
      player1Status.textContent = "LOSS";
      player1Status.classList.add("status-loss");
      player2Status.textContent = "WIN";
      player2Status.classList.add("status-win");
    } else {
      player1Status.textContent = "DRAW";
      player2Status.textContent = "DRAW";
    }

    winnerText.textContent = message;
    winnerScreen.classList.remove("hidden");
  } else {
    // fallback banner if no winnerScreen element
    const banner = document.createElement("div");
    banner.className =
      "fixed top-0 left-0 right-0 bottom-0 flex items-center justify-center bg-black bg-opacity-80 text-white text-3xl font-bold z-50";
    banner.textContent = message;
    document.body.appendChild(banner);
  }
}

