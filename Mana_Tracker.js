
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



parseAndFilterGameStateMessages = function(log){
    
    var zones = [];
    var turnTracker = [];
    var lifeTracker = [];
    var manaTracker = [];
    var lastManaState = {};
    
    var turnNumber = 0;
    var activePlayer = 0;
    var p1Life = 0;
    var p2Life = 0;
    var p1Mana = [];
    var p2Mana = [];
        

    for (const match of log) {
        var parsedMatch = JSON.parse(match);
        var timestamp = parsedMatch.timestamp;
        if(parsedMatch.greToClientEvent){
            parsedMatch.greToClientEvent.greToClientMessages.forEach(message => {
                
                
                //Zones
                if (message.type == 'GREMessageType_GameStateMessage' && message.gameStateMessage.type == "GameStateType_Full") {
                    zones = message.gameStateMessage.zones
                }

                //Turn Tracker
                if (message.type == 'GREMessageType_GameStateMessage' && message.gameStateMessage.turnInfo && message.gameStateMessage.annotations) {
                    message.gameStateMessage.annotations.forEach(annotation => {
                        if (annotation.type[0] == ["AnnotationType_NewTurnStarted"]){
                            turnNumber = message.gameStateMessage.turnInfo.turnNumber
                        activePlayer = message.gameStateMessage.turnInfo.activePlayer
                        turnTracker.push({"timestamp": timestamp, "turnNumber": turnNumber, "activePlayer": activePlayer})
    
                        }
                    })              
                }
                
                //Life Tracker
                if (message.type == 'GREMessageType_GameStateMessage' && message.gameStateMessage.players) {
                    
                       message.gameStateMessage.players.forEach(player => {
                           if(player.systemSeatNumber == 1){
                               p1Life = player.lifeTotal;
                           }
                           else {
                               p2Life = player.lifeTotal
                           }
                       })
                       lifeTracker.push({"timestamp": timestamp, "p1Life": p1Life, "p2Life": p2Life})                    
                }

                //Mana Tracker
                if (message.type == 'GREMessageType_GameStateMessage' && message.gameStateMessage.annotations){
                    message.gameStateMessage.annotations.forEach(annotation => {
                        
                        var manaBuffer = [];
                                                
                        if ((annotation.type[0] == ["AnnotationType_NewTurnStarted"] && message.gameStateMessage.actions)){
                            activePlayer = message.gameStateMessage.turnInfo.activePlayer
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
                                if (act.action.actionType == "ActionType_Activate_Mana" && act.action.manaPaymentOptions.length <= 1 && annotation.affectorId == activePlayer) {
                                    act.action.manaPaymentOptions.forEach(option => {
                                        //build a set of colors for shared cases.
                                        var colorBuffer =[];
                                        
                                        //Finds all mana associated with the activePlayer and pushes into the buffer array.
                                        if(shared == false){
                                            console.log('++++++++++++NOT SHARED++++++++++++++', option.mana[0].color, turnNumber, act.seatId, annotation.affectorId, message.gameStateMessage.turnInfo.activePlayer)
                                            manaBuffer.push({ "affector": act.action.sourceId, "color": [option.mana[0].color], "shared": shared}) 
                                        }

                                        //Finds all instances of mana with multiple mana generating actions in 2
                                        if(shared == true){
                                            console.log('+++++++++++SHARED+++++++++++++++', turnNumber, option.mana[0].color, act.seatId, annotation.affectorId, message.gameStateMessage.turnInfo.activePlayer)
                                            
                                            //checks if there are other manas with the same sourceId in the mana buffer. 
                                            checkManaExists = manaBuffer.some(manaCheck => {
                                                
                                                return manaCheck.affector == act.action.sourceId 
                                            })

                                            //if it doesn't exist in the buffer already, push the color to the color buffer to be added to the push.
                                            
                                            if(checkManaExists == false){
                                                message.gameStateMessage.actions.forEach(sharedManaAction => {
                                                    if(sharedManaAction.action.sourceId == act.action.sourceId){
                                                        var currentColor = sharedManaAction.action.manaPaymentOptions[0]
                                                        colorBuffer.push(currentColor.mana[0].color)
                                                    }
                                                    
                                                })

                                                console.log('+++++++++++++SHARED SPLIT+++++++++++++', colorBuffer, turnNumber, act.seatId, annotation.affectorId)
                                                manaBuffer.push({ "affector": act.action.sourceId, "color": colorBuffer, "shared": shared})
                                            }
                                              

                                        }      
                                                                          
                                    })                                        
                                }

                                //process cases where there are multiple paymentoptions in a single Activate_Mana action.
                                if (act.action.actionType == "ActionType_Activate_Mana" && act.action.manaPaymentOptions.length > 1){
                                    var colorBufferMulti = [];
                                    act.action.manaPaymentOptions.forEach(option => {
                                        colorBufferMulti.push(option.mana[0].color)
                                    })
                                    
                                    if(annotation.affectorId == act.seatId  && shared == true){
                                        console.log('+++++++++++++SHARED MULTI+++++++++++++', colorBufferMulti, turnNumber, act.seatId, annotation.affectorId, message.gameStateMessage.turnInfo.activePlayer)
                                        manaBuffer.push({ "affector": act.action.sourceId, "color": colorBufferMulti, "shared": shared})
                                    }
                                    
                                }
                                
                                //push the mana buffer to the correct mana array depending on player.
                                if(activePlayer == 1){
                                    //console.log('+++++++++++++P1P1P1P1+++++++++++++')
    
                                    p1Mana = manaBuffer;
        
                                }
                                else if((activePlayer == 2)){
                                    //console.log('+++++++++++++P2P2P2P2+++++++++++++')
                                    p2Mana = manaBuffer;
                                }
                                count = 0;
                                
                            })
                        }

                        // //if the annotation says mana has been paid, it should remove it from the 
                        if (annotation.type[0] == 'AnnotationType_ManaPaid') {
                            var affector = annotation.affectorId;
                            var manaOwner = 0;
                            var colorPaid = 0;
                            var count = 0;
                            
                            
                            message.gameStateMessage.actions.forEach(action => {
                                if(action.action.sourceId == affector){
                                    manaOwner = action.seatId;
                                }
                                
                            })                            
                            annotation.details.forEach(detail => {
                                if (detail.key == 'color') {
                                    colorPaid = detail.valueInt32[0];
                                }
                            });
                            
                            if(manaOwner == 1){
                                p1Mana.forEach((mana, index) => {
                                    if(mana.affector == affector){
                                        p1Mana.splice(index, 1)
                                    }
                                })
                            }
                            else if (manaOwner == 2){
                                p2Mana.forEach((mana, index) => {
                                    if(mana.affector == affector){
                                        p2Mana.splice(index, 1)
                                    }
                                })
                            }
                        }
                        if(annotation.type[0] == 'AnnotationType_ZoneTransfer'){
                            var affected = annotation.affectedIds[0]

                            annotation.details.forEach(detail => {
                                if (detail.key == 'category' && detail.valueString[0] == 'PlayLand'){
                                    message.gameStateMessage.gameObjects.forEach(gameObject => {
                                        if(gameObject.instanceId == affected && gameObject.isTapped !== true){
                                            //I haven't finished this, but when a land is played I want to get the id of the
                                            //land that was played, check if it isTapped = false, and get the activate mana 
                                            //actions that it has and add it to the proper array, p1Mana or p2Mana.



                                        }
                                    })

                                }
                            })
                        }
                        
                    })
                } 
                             
            })  
            console.log(timestamp,"p1Mana", p1Mana, "p2Mana", p2Mana)
            manaTracker.push({timestamp, p1Mana, p2Mana})             
        }                   
    }
     /*   
    //remove exact duplicates
    manaTracker.forEach((mana, i) => {
        manaTracker.forEach((comparator, index) => {
            if(comparator === mana || (comparator.timestamp == mana.timestamp && index >= 1)){
                manaTracker.splice(index, 1)
            }
        })
    })*/

    // return manaTracker
};


/*This is where I need the data to end up so it can be processed into the points of a graph. I have it working
on one of the P1 array and it produces a graph with hard edges. This is the end goal how I need the data. 
The graph will just represent the total of mana, and the types/colors will be assocated in the final output. */

var manaArray = parseAndFilterGameStateMessages(stringLogMatch)
// intialTimestamp = manaArray[0].timestamp - '100'
// manaArray.unshift({"timestamp": JSON.stringify(intialTimestamp), "p1Mana": [], "p2Mana": []});



// var p1ManaChartPoints = [[0, 0]];
// var p2ManaChartPoints = [[0, 0]];
// var lastPointP1 = 0;
// var lastYPointP1 = 0;
// manaArray.forEach((item, index )=> {
//     if(index >= 1) {var xPos = Math.round((item.timestamp - manaArray[index - 1].timestamp)/1000);}else{ xPos = 0}
//     var yPosP1 = item.p1Mana.length;
//     var yPosP2 = item.p2Mana.length;
//     var lineLength = Math.round(xPos *0.01) + lastPointP1
//     p1ManaChartPoints.push([lineLength * 10 , lastYPointP1 * -40])
//     p1ManaChartPoints.push([lineLength * 10, yPosP1 * -40])
//     //console.log(xPos, Math.round(xPos *0.01), lastPointP1, lineLength, yPosP1)
//     lastPointP1 = lastPointP1 + xPos;
//     lastYPointP1 = yPosP1;
// })


// //log all the chart points. These points get ingested into a graphing program.
// p1ManaChartPoints.forEach(log => {
//     console.log(log)
// })


// fs.writeFileSync('compiledLog.json', JSON.stringify(p1ManaChartPoints));


// manaArray.forEach(manaItem => {
//     console.log("-- P1Mana -- -- P1Mana ---- P1Mana --", "\n", manaItem.p1Mana, "\n-- P2Mana -- -- P2Mana ---- P2Mana --", "\n", manaItem.p2Mana)
// })


// console.log(manaArray.length)