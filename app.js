import { WebSocketServer } from "ws";
import randomstring from "randomstring";

import wordsFile from "./misc/words.json" assert {type: "json"};;
import asciiMappingsFile from "./misc/ascii.json" assert {type: "json"};;

const words = wordsFile.words;
const asciiMappings = asciiMappingsFile.asciiMappings;

const wsServer = new WebSocketServer({ port: process.env.PORT || 4000 });

let currentGames = [];

const wait = seconds => new Promise(resolve => setTimeout(resolve, seconds * 1000));
const randomInt = (minimum, maximum) => Math.floor(Math.random() * (maximum - minimum + 1)) + minimum;

const startGame = async game => {
    for (const player of game.players) {
        player.socket.send(JSON.stringify({
            action: "game_ready",
            gameId: game.id
        }));
    }

    let addedWords = 0;
    while (addedWords < 16) {
        const word = words[randomInt(0, words.length - 1)];
        if (!game.words.includes(word)) {
            const characters = [...word];

            game.words.push({
                characters: characters.map(character => ({
                    character: character,
                    solution: asciiMappings.filter(item => item.character === character)[0].binary
                })),
            });
            addedWords += 1;
        }
    }

    await wait(3);

    game.stage = "ascii_solving";

    for (const player of game.players) {
        player.currentWordToSolve = game.words[0];

        player.socket.send(JSON.stringify({
            action: "new_ascii_word_to_solve",
            gameId: game.id,
            word: player.currentWordToSolve
        }));
    }
}

wsServer.on("connection", ws => {
    let socketId = randomstring.generate(16);

    ws.on("message", message => {
        const json = JSON.parse(message.toString());
        if (!json || !json["action"]) { return; }

        console.log("Received JSON message");
        console.log(json);

        switch (json["action"]) {
            case "new_game": {
                const gameId = randomstring.generate(16);
                const gameCode = randomstring.generate({
                    length: 6,
                    charset: "numeric"
                });

                currentGames.push({
                    stage: "waiting_for_players",
                    host: {
                        id: socketId,
                        socket: ws
                    },
                    id: gameId,
                    code: gameCode,
                    players: [],
                    words: []
                });

                ws.send(JSON.stringify({
                    action: "new_game_result",
                    success: true,
                    gameId: gameId,
                    gameCode: gameCode
                }));

                break;
            }
            case "start_game": {
                const gameId = json["gameId"];
                const game = gameId && currentGames.filter(game => game.id === gameId && game.stage === "waiting_for_players")[0];

                if (!game) {
                    ws.send(JSON.stringify({
                        action: "start_game_result",
                        success: false
                    }));
                    return;
                }

                startGame(game);

                ws.send(JSON.stringify({
                    action: "start_game_result",
                    success: true
                }));

                break;
            }
            case "stop_game": {
                const gameId = json["gameId"];
                const game = gameId && currentGames.filter(game => game.id === gameId)[0];

                if (!game) {
                    ws.send(JSON.stringify({
                        action: "stop_game_result",
                        success: false
                    }));
                    return;
                }

                for (const socket of game.players.map(player => player.socket)) {
                    socket.send(JSON.stringify({
                        action: "stop_game"
                    }));
                }

                ws.send(JSON.stringify({
                    action: "stop_game_result",
                    success: true
                }));

                break;
            }
            case "join_game": {
                const gameCode = json["gameCode"];
                const game = gameCode && currentGames.filter(game => game.code === gameCode && game.stage === "waiting_for_players")[0];

                if (!game) {
                    ws.send(JSON.stringify({
                        action: "join_game_result",
                        success: false
                    }));
                    return;
                }

                const displayName = json["displayName"];

                if (!displayName || game.players.filter(player => player.id === socketId || player.displayName === displayName).length > 0) {
                    ws.send(JSON.stringify({
                        action: "join_game_result",
                        success: false
                    }));
                    return;
                }

                game.players.push({
                    id: socketId,
                    socket: ws,
                    displayName: displayName,
                    points: 0,
                    currentWordToSolve: null,
                    solvedCharactersInCurrentWord: 0,
                    solvedWords: 0
                });

                ws.send(JSON.stringify({
                    action: "join_game_result",
                    success: true,
                    gameId: game.id
                }));

                game.host.socket.send(JSON.stringify({
                    action: "player_join",
                    gameId: game.id,
                    playerId: socketId,
                    playerDisplayName: displayName
                }));

                break;
            }
            case "solve_ascii_character": {
                const gameId = json["gameId"];
                const game = gameId && currentGames.filter(game => game.id === gameId && game.stage === "ascii_solving")[0];
                const player = game && game.players.filter(p => p.id === socketId)[0];

                const solution = json["solution"];
                const isSolutionCorrect = player && solution && (player.currentWordToSolve.characters[player.solvedCharactersInCurrentWord].solution === solution);

                if (!isSolutionCorrect) {
                    ws.send(JSON.stringify({
                        action: "solve_ascii_character_result",
                        success: false
                    }));
                    return;
                }

                player.points += [...solution].filter(character => character === "1").length * 10;
                player.solvedCharactersInCurrentWord += 1;

                if (player.solvedCharactersInCurrentWord === player.currentWordToSolve.characters.length) {
                    player.solvedWords += 1;
                    player.solvedCharactersInCurrentWord = 0;
                    player.currentWordToSolve = game.words[player.solvedWords];

                    if (player.currentWordToSolve) {
                        ws.send(JSON.stringify({
                            action: "new_ascii_word_to_solve",
                            gameId: game.id,
                            word: player.currentWordToSolve
                        }));
                    }
                }

                ws.send(JSON.stringify({
                    action: "own_points_update",
                    gameId: game.id,
                    points: player.points
                }));

                game.host.socket.send(JSON.stringify({
                    action: "player_points_update",
                    gameId: game.id,
                    playerId: player.id,
                    points: player.points
                }));

                break;
            }
            default:
                return;
        }
    });
});
