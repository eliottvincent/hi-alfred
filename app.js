/*
 * Copyright 2016-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

/* jshint node: true, devel: true */
'use strict';

const bodyParser = require('body-parser');
const crypto = require('crypto');
const express = require('express');
const https = require('https');
const mqtt = require('mqtt')
const request = require('request');

// Express server
const app = express();
app.set('port', process.env.PORT || 5000);
app.set('view engine', 'ejs');
app.use(bodyParser.json({ verify: verifyRequestSignature }));
app.use(express.static('public'));

// MQTT PubSub client
const client  = mqtt.connect('mqtt://broker.mqtt-dashboard.com');

// App Secret can be retrieved from the App Dashboard
const APP_SECRET = process.env.MESSENGER_APP_SECRET;

// Arbitrary value used to validate a webhook
const VALIDATION_TOKEN = process.env.MESSENGER_VALIDATION_TOKEN;

// Generate a page access token for your page from the App Dashboard
const PAGE_ACCESS_TOKEN = process.env.MESSENGER_PAGE_ACCESS_TOKEN;

// URL where the app is running (include protocol). Used to point to scripts and
// assets located at this address.
const SERVER_URL = process.env.SERVER_URL;

if (!(APP_SECRET && VALIDATION_TOKEN && PAGE_ACCESS_TOKEN && SERVER_URL)) {
	console.error("Missing config values");
	process.exit(1);
}

let waitingUser = "";

/*
 * Use your own validation token. Check that the token used in the Webhook
 * setup is the same token used here.
 *
 */
app.get('/webhook', function(req, res) {
	if (req.query['hub.mode'] === 'subscribe' &&
		req.query['hub.verify_token'] === VALIDATION_TOKEN) {
		console.log("Validating webhook");
		res.status(200).send(req.query['hub.challenge']);
	} else {
		console.error("Failed validation. Make sure the validation tokens match.");
		res.sendStatus(403);
	}
});


/*
 * All callbacks for Messenger are POST-ed. They will be sent to the same
 * webhook. Be sure to subscribe your app to your page to receive callbacks
 * for your page.
 * https://developers.facebook.com/docs/messenger-platform/product-overview/setup#subscribe_app
 *
 */
app.post('/webhook', function (req, res) {
	const data = req.body;

	// Make sure this is a page subscription
	if (data.object === 'page') {
		// Iterate over each entry
		// There may be multiple if batched
		data.entry.forEach(function(pageEntry) {
			const pageID = pageEntry.id;
			const timeOfEvent = pageEntry.time;

			// Iterate over each messaging event
			pageEntry.messaging.forEach(function(messagingEvent) {
				if (messagingEvent.optin) {
					receivedAuthentication(messagingEvent);
				} else if (messagingEvent.message) {
					receivedMessage(messagingEvent);
				} else if (messagingEvent.delivery) {
					receivedDeliveryConfirmation(messagingEvent);
				} else if (messagingEvent.postback) {
					receivedPostback(messagingEvent);
				} else if (messagingEvent.read) {
					receivedMessageRead(messagingEvent);
				} else if (messagingEvent.account_linking) {
					receivedAccountLink(messagingEvent);
				} else {
					console.log("Webhook received unknown messagingEvent: ", messagingEvent);
				}
			});
		});

		// Assume all went well.
		//
		// You must send back a 200, within 20 seconds, to let us know you've
		// successfully received the callback. Otherwise, the request will time out.
		res.sendStatus(200);
	}
});

/*
 * This path is used for account linking. The account linking call-to-action
 * (sendAccountLinking) is pointed to this URL.
 *
 */
app.get('/authorize', function(req, res) {
	const accountLinkingToken = req.query.account_linking_token;
	const redirectURI = req.query.redirect_uri;

	// Authorization Code should be generated per user by the developer. This will
	// be passed to the Account Linking callback.
	const authCode = "1234567890";

	// Redirect users to this URI on successful login
	const redirectURISuccess = redirectURI + "&authorization_code=" + authCode;

	res.render('authorize', {
		accountLinkingToken: accountLinkingToken,
		redirectURI: redirectURI,
		redirectURISuccess: redirectURISuccess
	});
});

/*
 * Verify that the callback came from Facebook. Using the App Secret from
 * the App Dashboard, we can verify the signature that is sent with each
 * callback in the x-hub-signature field, located in the header.
 *
 * https://developers.facebook.com/docs/graph-api/webhooks#setup
 *
 */
function verifyRequestSignature(req, res, buf) {
	const signature = req.headers["x-hub-signature"];

	if (!signature) {
		// For testing, let's log an error. In production, you should throw an
		// error.
		console.error("Couldn't validate the signature.");
	} else {
		const elements = signature.split('=');
		const method = elements[0];
		const signatureHash = elements[1];

		const expectedHash = crypto.createHmac('sha1', APP_SECRET)
			.update(buf)
			.digest('hex');

		if (signatureHash !== expectedHash) {
			throw new Error("Couldn't validate the request signature.");
		}
	}
}

/*
 * Authorization Event
 *
 * The value for 'optin.ref' is defined in the entry point. For the "Send to
 * Messenger" plugin, it is the 'data-ref' field. Read more at
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/authentication
 *
 */
function receivedAuthentication(event) {
	const senderID = event.sender.id;
	const recipientID = event.recipient.id;
	const timeOfAuth = event.timestamp;

	// The 'ref' field is set in the 'Send to Messenger' plugin, in the 'data-ref'
	// The developer can set this to an arbitrary value to associate the
	// authentication callback with the 'Send to Messenger' click event. This is
	// a way to do account linking when the user clicks the 'Send to Messenger'
	// plugin.
	const passThroughParam = event.optin.ref;

	console.log("Received authentication for user %d and page %d with pass through param '%s' at %d", senderID, recipientID, passThroughParam, timeOfAuth);

	// When an authentication is received, we'll send a message back to the sender
	// to let them know it was successful.
	sendTextMessage(senderID, "Authentication successful");
}

/*
 * Message Event
 *
 * This event is called when a message is sent to your page. The 'message'
 * object format can consty depending on the kind of message that was received.
 * Read more at https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-received
 *
 * For this example, we're going to echo any text that we get. If we get some
 * special keywords ('button', 'generic', 'receipt'), then we'll send back
 * examples of those bubbles to illustrate the special message bubbles we've
 * created. If we receive a message with an attachment (image, video, audio),
 * then we'll simply confirm that we've received the attachment.
 *
 */
function receivedMessage(event) {
	const senderID = event.sender.id;
	const recipientID = event.recipient.id;
	const timeOfMessage = event.timestamp;
	const message = event.message;

	console.log("Received message for user %d and page %d at %d with message:", senderID, recipientID, timeOfMessage);
	console.log(JSON.stringify(message));

	const isEcho = message.is_echo;
	const messageId = message.mid;
	const appId = message.app_id;
	const metadata = message.metadata;

	// You may get a text or attachment but not both
	const messageText = message.text;
	const messageAttachments = message.attachments;
	const quickReply = message.quick_reply;
	const nlp = message.nlp;

	if (isEcho) {
		// Just logging message echoes to console
		console.log("Received echo for message %s and app %d with metadata %s",
			messageId, appId, metadata);
		return;
	} else if (quickReply) {
		const quickReplyPayload = quickReply.payload;
		console.log("Quick reply for message %s with payload %s",
			messageId, quickReplyPayload);

		sendTextMessage(senderID, "Quick reply tapped");
		return;
	}

	if (messageText) {

		// If we receive a text message, check to see if it matches any special
		// keywords and send back the corresponding example. Otherwise, just echo
		// the text we received.
		switch (messageText.replace(/[^\w\s]/gi, '').trim().toLowerCase()) {

			case 'hello':
			case 'hi':
				sendHiMessage(senderID);
				break;

			case 'temperature':
			case 'temprature':	// température becomes temprature
			case 'temp':
			case 'tmp':
				requestTemperature(senderID);
				break;

			case '+':
			case 'up':
				requestUpTemperature(senderID);
				break;

			case '-':
			case 'down':
				requestDownTemperature(senderID);
				break;

			case 'on':
				requestLightOn(senderID);
				break;

			case 'off':
				requestLightOff(senderID);
				break;

			case 'image':
				requiresServerURL(sendImageMessage, [senderID]);
				break;

			case 'gif':
				requiresServerURL(sendGifMessage, [senderID]);
				break;

			case 'audio':
				requiresServerURL(sendAudioMessage, [senderID]);
				break;

			case 'video':
				requiresServerURL(sendVideoMessage, [senderID]);
				break;

			case 'file':
				requiresServerURL(sendFileMessage, [senderID]);
				break;

			case 'button':
				sendButtonMessage(senderID);
				break;

			case 'generic':
				requiresServerURL(sendGenericMessage, [senderID]);
				break;

			case 'receipt':
				requiresServerURL(sendReceiptMessage, [senderID]);
				break;

			case 'quick reply':
				sendQuickReply(senderID);
				break;

			case 'read receipt':
				sendReadReceipt(senderID);
				break;

			case 'typing on':
				sendTypingOn(senderID);
				break;

			case 'typing off':
				sendTypingOff(senderID);
				break;

			case 'account linking':
				requiresServerURL(sendAccountLinking, [senderID]);
				break;

			default:
				sendTextMessage(senderID, messageText);
		}
	} else if (messageAttachments) {
		sendTextMessage(senderID, "Message with attachment received");
	}
}


/*
 * Delivery Confirmation Event
 *
 * This event is sent to confirm the delivery of a message. Read more about
 * these fields at https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-delivered
 *
 */
function receivedDeliveryConfirmation(event) {
	const senderID = event.sender.id;
	const recipientID = event.recipient.id;
	const delivery = event.delivery;
	const messageIDs = delivery.mids;
	const watermark = delivery.watermark;
	const sequenceNumber = delivery.seq;

	if (messageIDs) {
		messageIDs.forEach(function(messageID) {
			console.log("Received delivery confirmation for message ID: %s",
				messageID);
		});
	}

	console.log("All message before %d were delivered.", watermark);
}


/*
 * Postback Event
 *
 * This event is called when a postback is tapped on a Structured Message.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/postback-received
 *
 */
function receivedPostback(event) {
	const senderID = event.sender.id;
	const recipientID = event.recipient.id;
	const timeOfPostback = event.timestamp;

	// The 'payload' param is a developer-defined field which is set in a postback
	// button for Structured Messages.
	const payload = event.postback.payload;

	console.log("Received postback for user %d and page %d with payload '%s' at %d", senderID, recipientID, payload, timeOfPostback);

	switch (payload) {

		case 'LED':
			requestLedStatus(senderID);
			break;

		case 'LED_SET_YES':
			requestLedSet(senderID);
			break;

		case 'LED_SET_NO':
			sendLedSetNoMessage(senderID);
			break;

		default:
			sendTextMessage(senderID, "Postback called");
			break;
	}
}

/*
 * Message Read Event
 *
 * This event is called when a previously-sent message has been read.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-read
 *
 */
function receivedMessageRead(event) {
	const senderID = event.sender.id;
	const recipientID = event.recipient.id;

	// All messages before watermark (a timestamp) or sequence have been seen.
	const watermark = event.read.watermark;
	const sequenceNumber = event.read.seq;

	console.log("Received message read event for watermark %d and sequence " +
		"number %d", watermark, sequenceNumber);
}

/*
 * Account Link Event
 *
 * This event is called when the Link Account or UnLink Account action has been
 * tapped.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/account-linking
 *
 */
function receivedAccountLink(event) {
	const senderID = event.sender.id;
	const recipientID = event.recipient.id;

	const status = event.account_linking.status;
	const authCode = event.account_linking.authorization_code;

	console.log("Received account link event with for user %d with status %s and auth code %s ", senderID, status, authCode);
}

/*
 * If users came here through testdrive, they need to configure the server URL
 * in default.json before they can access local resources likes images/videos.
 */
function requiresServerURL(next, [recipientId, ...args]) {
	if (SERVER_URL === "to_be_set_manually") {
		const messageData = {
			recipient: {
				id: recipientId
			},
			message: {
				text: `
We have static resources like images and videos available to test, but you need to update the code you downloaded earlier to tell us your current server url.
1. Stop your node server by typing ctrl-c
2. Paste the result you got from running "lt —port 5000" into your config/default.json file as the "serverURL".
3. Re-run "node app.js"
Once you've finished these steps, try typing “video” or “image”.
        `
			}
		};

		callSendAPI(messageData);
	} else {
		next.apply(this, [recipientId, ...args]);
	}
}

function sendHiMessage(recipientId) {
	const messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			text: `
Hi! I'm Alfred 👨🏻
      `
		}
	};

	callSendAPI(messageData);
}


function sendLedMessage(status) {

	console.log('sendLedMessage is triggered: ' + status);

	const st = (status === '0' ? 'éteinte' : 'allumée');
	const stBis = (status === '0' ? 'allumer' : 'éteindre');
	const messageData = {
		recipient: {
			id: waitingUser
		},
		message: {
			text: 'L\'ampoule est actuellement ' + st + '. Souhaitez-vous l\'' + stBis + ' ?',
			quick_replies: [
				{
					"content_type":"text",
					"title":"Oui",
					"payload":"LED_SET_YES"
				},				{
					"content_type":"text",
					"title":"Non",
					"payload":"LED_SET_NO"
				}
			]
		}
	};

	callSendAPI(messageData);

	waitingUser = "";
}

function requestLedStatus(senderID) {

	// command to ask temperature to MQTT Broker
	client.publish('HiAlfredCommand', '3');

	waitingUser = senderID;

	sendTypingOn(senderID);
}

function requestLedSet(senderID) {

	// command to ask temperature to MQTT Broker
	client.publish('HiAlfredCommand', '4');

	const messageData = {
		recipient: {
			id: senderID
		},
		message: {
			text: 'C\'est fait! 👍🏼'
		}
	};
	callSendAPI(messageData);
}

function requestTemperature(senderID) {

	// command to ask temperature to MQTT Broker
	client.publish('HiAlfredCommand', '0');

	waitingUser = senderID;

	sendTypingOn(senderID);
}

function requestLightOn(senderID) {

	// command to ask temperature to MQTT Broker
	client.publish('HiAlfredCommand', '+');

	const messageData = {
		recipient: {
			id: senderID
		},
		message: {
			text: 'I switched the light on'
		}
	};
	callSendAPI(messageData);
}
function requestLightOff(senderID) {

	// command to ask temperature to MQTT Broker
	client.publish('HiAlfredCommand', '-');

	const messageData = {
		recipient: {
			id: senderID
		},
		message: {
			text: 'I switched the light off'
		}
	};
	callSendAPI(messageData);
}
function requestUpTemperature(senderID) {

	// command to ask temperature to MQTT Broker
	client.publish('HiAlfredCommand', '2');

	const messageData = {
		recipient: {
			id: senderID
		},
		message: {
			text: 'UP temperature'
		}
	};
	callSendAPI(messageData);
}

function requestDownTemperature(senderID) {

	// command to ask temperature to MQTT Broker
	client.publish('HiAlfredCommand', '-');

	const messageData = {
		recipient: {
			id: senderID
		},
		message: {
			text: 'DOWN temperature'
		}
	};
	callSendAPI(messageData);
}


function sendTemperatureMessage(tmp) {

	const messageData = {
		recipient: {
			id: waitingUser
		},
		message: {
			text: 'The temperature is actually ' + tmp + '°C'
		}
	};
	callSendAPI(messageData);

	waitingUser = "";
}


/*
 * Send an image using the Send API.
 *
 */
function sendImageMessage(recipientId) {
	const messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "image",
				payload: {
					url: SERVER_URL + "/assets/rift.png"
				}
			}
		}
	};

	callSendAPI(messageData);
}

/*
 * Send a Gif using the Send API.
 *
 */
function sendGifMessage(recipientId) {
	const messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "image",
				payload: {
					url: SERVER_URL + "/assets/instagram_logo.gif"
				}
			}
		}
	};

	callSendAPI(messageData);
}

/*
 * Send audio using the Send API.
 *
 */
function sendAudioMessage(recipientId) {
	const messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "audio",
				payload: {
					url: SERVER_URL + "/assets/sample.mp3"
				}
			}
		}
	};

	callSendAPI(messageData);
}

/*
 * Send a video using the Send API.
 *
 */
function sendVideoMessage(recipientId) {
	const messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "video",
				payload: {
					url: SERVER_URL + "/assets/allofus480.mov"
				}
			}
		}
	};

	callSendAPI(messageData);
}

/*
 * Send a file using the Send API.
 *
 */
function sendFileMessage(recipientId) {
	const messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "file",
				payload: {
					url: SERVER_URL + "/assets/test.txt"
				}
			}
		}
	};

	callSendAPI(messageData);
}

/*
 * Send a text message using the Send API.
 *
 */
function sendTextMessage(recipientId, messageText) {
	const messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			text: messageText,
			metadata: "DEVELOPER_DEFINED_METADATA"
		}
	};

	callSendAPI(messageData);
}

/*
 * Send a button message using the Send API.
 *
 */
function sendButtonMessage(recipientId) {
	const messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "template",
				payload: {
					template_type: "button",
					text: "This is test text",
					buttons:[{
						type: "web_url",
						url: "https://www.oculus.com/en-us/rift/",
						title: "Open Web URL"
					}, {
						type: "postback",
						title: "Trigger Postback",
						payload: "DEVELOPER_DEFINED_PAYLOAD"
					}, {
						type: "phone_number",
						title: "Call Phone Number",
						payload: "+16505551234"
					}]
				}
			}
		}
	};

	callSendAPI(messageData);
}

/*
 * Send a Structured Message (Generic Message type) using the Send API.
 *
 */
function sendGenericMessage(recipientId) {
	const messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "template",
				payload: {
					template_type: "generic",
					elements: [{
						title: "rift",
						subtitle: "Next-generation virtual reality",
						item_url: "https://www.oculus.com/en-us/rift/",
						image_url: SERVER_URL + "/assets/rift.png",
						buttons: [{
							type: "web_url",
							url: "https://www.oculus.com/en-us/rift/",
							title: "Open Web URL"
						}, {
							type: "postback",
							title: "Call Postback",
							payload: "Payload for first bubble",
						}],
					}, {
						title: "touch",
						subtitle: "Your Hands, Now in VR",
						item_url: "https://www.oculus.com/en-us/touch/",
						image_url: SERVER_URL + "/assets/touch.png",
						buttons: [{
							type: "web_url",
							url: "https://www.oculus.com/en-us/touch/",
							title: "Open Web URL"
						}, {
							type: "postback",
							title: "Call Postback",
							payload: "Payload for second bubble",
						}]
					}]
				}
			}
		}
	};

	callSendAPI(messageData);
}

/*
 * Send a receipt message using the Send API.
 *
 */
function sendReceiptMessage(recipientId) {
	// Generate a random receipt ID as the API requires a unique ID
	const receiptId = "order" + Math.floor(Math.random()*1000);

	const messageData = {
		recipient: {
			id: recipientId
		},
		message:{
			attachment: {
				type: "template",
				payload: {
					template_type: "receipt",
					recipient_name: "Peter Chang",
					order_number: receiptId,
					currency: "USD",
					payment_method: "Visa 1234",
					timestamp: "1428444852",
					elements: [{
						title: "Oculus Rift",
						subtitle: "Includes: headset, sensor, remote",
						quantity: 1,
						price: 599.00,
						currency: "USD",
						image_url: SERVER_URL + "/assets/riftsq.png"
					}, {
						title: "Samsung Gear VR",
						subtitle: "Frost White",
						quantity: 1,
						price: 99.99,
						currency: "USD",
						image_url: SERVER_URL + "/assets/gearvrsq.png"
					}],
					address: {
						street_1: "1 Hacker Way",
						street_2: "",
						city: "Menlo Park",
						postal_code: "94025",
						state: "CA",
						country: "US"
					},
					summary: {
						subtotal: 698.99,
						shipping_cost: 20.00,
						total_tax: 57.67,
						total_cost: 626.66
					},
					adjustments: [{
						name: "New Customer Discount",
						amount: -50
					}, {
						name: "$100 Off Coupon",
						amount: -100
					}]
				}
			}
		}
	};

	callSendAPI(messageData);
}

/*
 * Send a message with Quick Reply buttons.
 *
 */
function sendQuickReply(recipientId) {
	const messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			text: "What's your favorite movie genre?",
			quick_replies: [
				{
					"content_type":"text",
					"title":"Action",
					"payload":"DEVELOPER_DEFINED_PAYLOAD_FOR_PICKING_ACTION"
				},
				{
					"content_type":"text",
					"title":"Comedy",
					"payload":"DEVELOPER_DEFINED_PAYLOAD_FOR_PICKING_COMEDY"
				},
				{
					"content_type":"text",
					"title":"Drama",
					"payload":"DEVELOPER_DEFINED_PAYLOAD_FOR_PICKING_DRAMA"
				}
			]
		}
	};

	callSendAPI(messageData);
}

/*
 * Send a read receipt to indicate the message has been read
 *
 */
function sendReadReceipt(recipientId) {
	console.log("Sending a read receipt to mark message as seen");

	const messageData = {
		recipient: {
			id: recipientId
		},
		sender_action: "mark_seen"
	};

	callSendAPI(messageData);
}

/*
 * Turn typing indicator on
 *
 */
function sendTypingOn(recipientId) {
	console.log("Turning typing indicator on");

	const messageData = {
		recipient: {
			id: recipientId
		},
		sender_action: "typing_on"
	};

	callSendAPI(messageData);
}

/*
 * Turn typing indicator off
 *
 */
function sendTypingOff(recipientId) {
	console.log("Turning typing indicator off");

	const messageData = {
		recipient: {
			id: recipientId
		},
		sender_action: "typing_off"
	};

	callSendAPI(messageData);
}

/*
 * Send a message with the account linking call-to-action
 *
 */
function sendAccountLinking(recipientId) {
	const messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "template",
				payload: {
					template_type: "button",
					text: "Welcome. Link your account.",
					buttons:[{
						type: "account_link",
						url: SERVER_URL + "/authorize"
					}]
				}
			}
		}
	};

	callSendAPI(messageData);
}

/*
 * Call the Send API. The message data goes in the body. If successful, we'll
 * get the message id in a response
 *
 */
function callSendAPI(messageData) {
	request({
		uri: 'https://graph.facebook.com/v2.6/me/messages',
		qs: { access_token: PAGE_ACCESS_TOKEN },
		method: 'POST',
		json: messageData

	}, (error, response, body) => {
		if (!error && response.statusCode === 200) {
			const recipientId = body.recipient_id;
			const messageId = body.message_id;

			if (messageId) {
				console.log("Successfully sent message with id %s to recipient %s",
					messageId, recipientId);
			} else {
				console.log("Successfully called Send API for recipient %s",
					recipientId);
			}
		} else {
			console.error("Failed calling Send API", response.statusCode, response.statusMessage, body.error);
		}
	});
}

// Start server
// Webhooks must be available via SSL with a certificate signed by a valid
// certificate authority.
app.listen(app.get('port'), function() {
	console.log('Node app is running on port', app.get('port'));
});

// workaround to avoid the app to fall in idle or sleep
setInterval(function () {
	https.get("https://hi-alfred.herokuapp.com/");
}, 1200000); // every 20 minutes (20 * 6 * 1000)


// Start PubSub client
client.on('connect', function () {

	client.subscribe('HiAlfredData/tmp');
	client.subscribe('HiAlfredData/led');
});

client.on('message', function (topic, message, packet) {

	console.log(JSON.stringify(packet, null, 4));

	if (topic === 'HiAlfredData/tmp') {

		console.log(message.toString());
		if (waitingUser !== "") {

			console.log('message: ' + message);
			sendTemperatureMessage(message);
		}
	}

	if (topic === 'HiAlfredData/led') {

		console.log(message.toString());

		console.log('waitingUser: ' + waitingUser);
		if (waitingUser !== "") {

			console.log('sendLedMessage will be triggered: ' + message);
			sendLedMessage(message);
		}
	}
	// client.end()
});


module.exports = app;
