
fs = require("fs");
https = require('https')
var logFile = fs.readFileSync('Log20220810_022152.log', (err, data) => {

    if (err) {
        throw err;
    }

    return data

});

//Use regex to build an array of log file objects
var reggie = /((?<=\n)\{).*(\}(?=\r\n))/g;
var stringLog = logFile.toString();
var stringLogMatch = stringLog.match(reggie);



parseAndFilterGameStateMessages = function (log) {

    var zones = [];
    var turnTracker = [];
    var lifeTracker = [];
    var manaTracker = [];
    var lastManaState = {};

    var turnNumber = 0;
    var activePlayer = 0;

    /* ADDING PLAYER ORDER IDENTIFIER */
    var p1 = 0;
    var p2 = 0;

    var p1Life = 0;
    var p2Life = 0;
    var p1Mana = [];
    var p2Mana = [];



    for (const match of log) {
        var parsedMatch = JSON.parse(match);
        var timestamp = parsedMatch.timestamp;
        if (parsedMatch.greToClientEvent) {
            parsedMatch.greToClientEvent.greToClientMessages.forEach(message => {

                /* ADDING NEW GAME INDICATOR */
                if (message.type == 'GREMessageType_ConnectResp') {
                    console.log('\n++++++++++++ NEW GAME INITIALIZATION ++++++++++++++')
                    /* resets mana for new game */
                    turnNumber = 0
                    p1Mana = []
                    p2Mana = []

                }

                //Zones
                if (message.type == 'GREMessageType_GameStateMessage' && message.gameStateMessage.type == "GameStateType_Full") {
                    zones = message.gameStateMessage.zones
                }

                //Turn Tracker
                if (message.type == 'GREMessageType_GameStateMessage' && message.gameStateMessage.turnInfo && message.gameStateMessage.annotations) {
                    message.gameStateMessage.annotations.forEach(annotation => {
                        if (annotation.type[0] == ["AnnotationType_NewTurnStarted"]) {

                            if (!message.gameStateMessage.turnInfo.turnNumber) {
                                turnNumber = 1;
                            } else {
                                turnNumber = message.gameStateMessage.turnInfo.turnNumber;
                            }
                            /* PLAYER ORDER IDENTIFIER */
                            if (turnNumber == 1 && message.gameStateMessage.turnInfo.activePlayer == 1) {
                                p1 = 1;
                                p2 = 2;
                            } else {
                                p1 = 2;
                                p2 = 1;
                            }
                            // activePlayer = message.gameStateMessage.turnInfo.activePlayer
                            turnTracker.push({ "timestamp": timestamp, "turnNumber": turnNumber, "activePlayer": activePlayer })
                            /* NEW TURN INDICATOR */
                            console.log('\n++++++++++++ TURN NUMBER: ' + turnNumber + ' ++++++++++++++')
                        }
                    })
                }

                //Life Tracker
                if (message.type == 'GREMessageType_GameStateMessage' && message.gameStateMessage.players) {

                    message.gameStateMessage.players.forEach(player => {
                        if (player.systemSeatNumber == 1) {
                            p1Life = player.lifeTotal;
                        }
                        else {
                            p2Life = player.lifeTotal
                        }
                    })
                    lifeTracker.push({ "timestamp": timestamp, "p1Life": p1Life, "p2Life": p2Life })
                }

                //Mana Tracker
                if (message.type == 'GREMessageType_GameStateMessage' && message.gameStateMessage.annotations) {

                    message.gameStateMessage.annotations.forEach(annotation => {

                        var manaBuffer = [];

                        var p1ManaBuffer = [...p1Mana]
                        var p2ManaBuffer = [...p2Mana]

                        /* On the untap phase, looks through each action for objects with a mana source and adds it to array */
                        if ((annotation.type[0] == ["AnnotationType_TappedUntappedPermanent"] && message.gameStateMessage.actions)) {

                            message.gameStateMessage.actions.forEach(act => {

                                count = 0;

                                //this just determines if a single card has multiple mana options. 
                                //Two cases: the first is multiple Activate_Mana action for a single "instanceId" 
                                //or a single Activate_Mana action with multiple manaPaymentOptions entries.
                                var shared = message.gameStateMessage.actions.some((element, index) => {

                                    if (element.action.sourceId == act.action.sourceId && act.action.actionType == "ActionType_Activate_Mana" && act.action.manaPaymentOptions) {
                                        count++
                                    }
                                    else if (act.action.manaPaymentOptions && act.action.manaPaymentOptions.length > 1 && act.action.actionType == "ActionType_Activate_Mana" && element.action.actionType == "ActionType_Activate_Mana") {
                                        count = act.action.manaPaymentOptions.length;
                                    }

                                    return count > 1;
                                });

                                //process all the actions.
                                if (act.action.actionType == "ActionType_Activate_Mana" /* && act.action.manaPaymentOptions.length <= 1 */ && act.action.sourceId == annotation.affectedIds[0]) {

                                    //build a set of colors for shared cases.
                                    var colorBuffer = [];

                                    /* checks if mana source already exists in array */
                                    var checkMana = obj => obj.affector === act.action.sourceId;

                                    var checkManaExists = false;

                                    act.action.manaPaymentOptions.forEach(option => {

                                        //Finds all mana associated with the activePlayer and pushes into the buffer array.
                                        if (shared == false) {

                                            if (act.seatId == p1) {

                                                p1ManaBuffer.push({ "affector": act.action.sourceId, "color": [option.mana[0].color], "shared": shared })
                                            } else if (act.seatId == p2) {

                                                p2ManaBuffer.push({ "affector": act.action.sourceId, "color": [option.mana[0].color], "shared": shared })

                                            }
                                        }

                                        //Finds all instances of mana with multiple mana generating actions in 2
                                        if (shared == true) {

                                            option.mana.forEach(manaColor => {
                                                colorBuffer.push(manaColor.color)
                                            })

                                            if (act.seatId == p1 && checkManaExists != true) {

                                                p1ManaBuffer.push({ "affector": act.action.sourceId, "color": colorBuffer, "shared": shared })

                                                checkManaExists = p1ManaBuffer.some(checkMana);

                                            } else if (act.seatId == p2 && checkManaExists != true) {

                                                p2ManaBuffer.push({ "affector": act.action.sourceId, "color": colorBuffer, "shared": shared })

                                                checkManaExists = p2ManaBuffer.some(checkMana);
                                            }

                                        }

                                    })
                                }

                                //process cases where there are multiple paymentoptions in a single Activate_Mana action.
                                if (act.action.actionType == "ActionType_Activate_Mana" && act.action.manaPaymentOptions.length > 1) {
                                    var colorBufferMulti = [];
                                    act.action.manaPaymentOptions.forEach(option => {
                                        colorBufferMulti.push(option.mana[0].color)
                                    })

                                    if (annotation.affectorId == act.seatId && shared == true) {
                                        console.log('+++++++++++++SHARED MULTI+++++++++++++', colorBufferMulti, turnNumber, act.seatId, annotation.affectorId, message.gameStateMessage.turnInfo.activePlayer)
                                        manaBuffer.push({ "affector": act.action.sourceId, "color": colorBufferMulti, "shared": shared })
                                    }

                                }

                                //push the mana buffer to the correct mana array depending on player.
                                if (act.seatId == p1) {

                                    p1Mana = p1ManaBuffer;

                                }
                                else if (act.seatId == p2) {

                                    p2Mana = p2ManaBuffer;
                                }
                                count = 0;

                            })

                        }


                        //if the annotation says mana has been paid, it should remove it from the array
                        /* still needs to account for other sources, only tracks land so far */
                        if (annotation.type[0] == 'AnnotationType_ManaPaid') {

                            var affector = annotation.affectorId;
                            var manaOwner = 0;
                            var colorPaid = 0;
                            var count = 0;

                            // tracks which player spends the mana
                            message.gameStateMessage.gameObjects.forEach(object => {
                                if (object.instanceId == affector) {
                                    manaOwner = object.controllerSeatId
                                }
                            })


                            annotation.details.forEach(detail => {
                                if (detail.key == 'color') {
                                    colorPaid = detail.valueInt32[0];
                                }
                            });

                            console.log("\n++++++ MANA EXPENDED TO CAST ++++++");
                            console.log(timestamp);

                            // removes spent mana source from appropriate player array
                            if (manaOwner == p1) {
                                for (var i = p1Mana.length - 1; i >= 0; --i) {

                                    if (p1Mana[i].affector == affector) {
                                        console.log("+++++ P1 MANA " + p1Mana[i].affector + " SPENT ++++++");
                                        p1Mana.splice(i, 1);
                                    }
                                }
                            }
                            else if (manaOwner == p2) {

                                for (var i = p2Mana.length - 1; i >= 0; --i) {

                                    if (p2Mana[i].affector == affector) {
                                        console.log("+++++ P2 MANA " + p2Mana[i].affector + " SPENT ++++++");
                                        p2Mana.splice(i, 1);
                                    }
                                }
                            }
                            else {
                                console.log("ERROR");
                            }

                        }

                        // removes mana if source is destroyed
                        /* TBD */

                        /* ======== ADDS MANA TO ARRAY ON PLAYLAND ============ */
                        /* still needs to account for other sources, only tracks land so far */
                        if (annotation.type[0] == 'AnnotationType_ZoneTransfer') {

                            var affected = annotation.affectedIds[0]

                            annotation.details.forEach(detail => {
                                if (detail.key == 'category' && detail.valueString[0] == 'PlayLand') {

                                    console.log("\n===== LAND PLAYED; TURN " + turnNumber + " ======");

                                    message.gameStateMessage.gameObjects.forEach(gameObject => {
                                        if (gameObject.instanceId == affected && gameObject.isTapped !== true) {

                                            message.gameStateMessage.actions.forEach(act => {

                                                count = 0;

                                                //this just determines if a single card has multiple mana options. 
                                                //Two cases: the first is multiple Activate_Mana action for a single "instanceId" 
                                                //or a single Activate_Mana action with multiple manaPaymentOptions entries.
                                                var shared = message.gameStateMessage.actions.some((element, index) => {

                                                    if (element.action.sourceId == act.action.sourceId && act.action.actionType == "ActionType_Activate_Mana" && act.action.manaPaymentOptions) {
                                                        count++
                                                    }
                                                    else if (act.action.manaPaymentOptions && act.action.manaPaymentOptions.length > 1 && act.action.actionType == "ActionType_Activate_Mana" && element.action.actionType == "ActionType_Activate_Mana") {
                                                        count = act.action.manaPaymentOptions.length;
                                                    }

                                                    return count > 1;
                                                });

                                                //process all the actions.
                                                if (act.action.actionType == "ActionType_Activate_Mana" /* && act.action.manaPaymentOptions.length <= 1 */ && act.action.sourceId == annotation.affectedIds[0]) {

                                                    //build a set of colors for shared cases.
                                                    var colorBuffer = [];

                                                    /* checks if mana source already exists in array */
                                                    var checkMana = obj => obj.affector === act.action.sourceId;

                                                    var checkManaExists = false;

                                                    act.action.manaPaymentOptions.forEach(option => {

                                                        //Finds all mana associated with the activePlayer and pushes into the buffer array.
                                                        if (shared == false) {

                                                            if (act.seatId == p1) {

                                                                p1ManaBuffer.push({ "affector": act.action.sourceId, "color": [option.mana[0].color], "shared": shared })
                                                            } else if (act.seatId == p2) {

                                                                p2ManaBuffer.push({ "affector": act.action.sourceId, "color": [option.mana[0].color], "shared": shared })

                                                            }
                                                        }

                                                        //Finds all instances of mana with multiple mana generating actions in 2
                                                        if (shared == true) {

                                                            option.mana.forEach(manaColor => {
                                                                colorBuffer.push(manaColor.color)
                                                            })

                                                            if (act.seatId == p1 && checkManaExists != true) {

                                                                p1ManaBuffer.push({ "affector": act.action.sourceId, "color": colorBuffer, "shared": shared })

                                                                checkManaExists = p1ManaBuffer.some(checkMana);

                                                            } else if (act.seatId == p2 && checkManaExists != true) {

                                                                p2ManaBuffer.push({ "affector": act.action.sourceId, "color": colorBuffer, "shared": shared })

                                                                checkManaExists = p2ManaBuffer.some(checkMana);
                                                            }

                                                        }

                                                    })
                                                }

                                                //process cases where there are multiple paymentoptions in a single Activate_Mana action.
                                                if (act.action.actionType == "ActionType_Activate_Mana" && act.action.manaPaymentOptions.length > 1) {
                                                    var colorBufferMulti = [];
                                                    act.action.manaPaymentOptions.forEach(option => {
                                                        colorBufferMulti.push(option.mana[0].color)
                                                    })

                                                    if (annotation.affectorId == act.seatId && shared == true) {
                                                        console.log('+++++++++++++SHARED MULTI+++++++++++++', colorBufferMulti, turnNumber, act.seatId, annotation.affectorId, message.gameStateMessage.turnInfo.activePlayer)
                                                        manaBuffer.push({ "affector": act.action.sourceId, "color": colorBufferMulti, "shared": shared })
                                                    }

                                                }

                                                //push the mana buffer to the correct mana array depending on player.
                                                if (act.seatId == p1) {

                                                    p1Mana = p1ManaBuffer;

                                                }
                                                else if (act.seatId == p2) {

                                                    p2Mana = p2ManaBuffer;
                                                }
                                                count = 0;

                                            })

                                        }
                                    })

                                }
                            })
                        }

                    })
                }

                /* handles adding new data to manaTracker and prevents exact copies */

                lastManaState = { timestamp, p1Mana, p2Mana, turnNumber }

                var dataExists = manaTracker.some(data => data.timestamp === lastManaState.timestamp && data.p1Mana === lastManaState.p1Mana && data.p2Mana === lastManaState.p2Mana);

                if (!dataExists) {

                    console.log("\n" + timestamp, "turn number " + turnNumber + " p1Mana", p1Mana, "p2Mana", p2Mana)

                    manaTracker.push(lastManaState)

                }
            })


        }
    }
    console.log("noice " + JSON.stringify(manaTracker));

    return manaTracker
};


/*This is where I need the data to end up so it can be processed into the points of a graph. I have it working
on one of the P1 array and it produces a graph with hard edges. This is the end goal how I need the data. 
The graph will just represent the total of mana, and the types/colors will be assocated in the final output. */

var manaArray = parseAndFilterGameStateMessages(stringLogMatch)
intialTimestamp = manaArray[0].timestamp - '100'
manaArray.unshift({ "timestamp": JSON.stringify(intialTimestamp), "p1Mana": [], "p2Mana": [] });



var p1ManaChartPoints = [[0, 0]];
var p2ManaChartPoints = [[0, 0]];
var lastPointP1 = 0;
var lastYPointP1 = 0;
manaArray.forEach((item, index) => {
    if (index >= 1) { var xPos = Math.round((item.timestamp - manaArray[index - 1].timestamp) / 1000); } else { xPos = 0 }
    var yPosP1 = item.p1Mana.length;
    var yPosP2 = item.p2Mana.length;
    var lineLength = Math.round(xPos * 0.01) + lastPointP1
    p1ManaChartPoints.push([lineLength * 10, lastYPointP1 * -40])
    p1ManaChartPoints.push([lineLength * 10, yPosP1 * -40])
    //console.log(xPos, Math.round(xPos *0.01), lastPointP1, lineLength, yPosP1)
    lastPointP1 = lastPointP1 + xPos;
    lastYPointP1 = yPosP1;
})


//log all the chart points. These points get ingested into a graphing program.
p1ManaChartPoints.forEach(log => {
    console.log(log)
})


fs.writeFileSync('compiledLog.json', JSON.stringify(p1ManaChartPoints));


manaArray.forEach(manaItem => {
    console.log("\nTimestamp: " + manaItem.timestamp + "\nTurn Number: " + manaItem.turnNumber + "\n-- P1Mana -- -- P1Mana ---- P1Mana --", "\n", manaItem.p1Mana, "\n-- P2Mana -- -- P2Mana ---- P2Mana --", "\n", manaItem.p2Mana)
})


console.log(manaArray.length)