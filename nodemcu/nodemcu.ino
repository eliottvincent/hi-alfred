#include <ESP8266WiFi.h>
#include <PubSubClient.h>
#include <LiquidCrystal_I2C.h>

// data pins definition
#define TMP_PIN A0
#define LED_PIN D8

// wifi and broker settings
const char* ssid = "Eliott's iPhone";
const char* password = "ntmmmmmm";
const char* mqtt_server = "iot.eclipse.org";

WiFiClient espClient;
PubSubClient client(espClient);
LiquidCrystal_I2C lcd(0x20, 16, 2);

char msg[50];




// ██╗    ██╗██╗███████╗██╗
// ██║    ██║██║██╔════╝██║
// ██║ █╗ ██║██║█████╗  ██║
// ██║███╗██║██║██╔══╝  ██║
// ╚███╔███╔╝██║██║     ██║
//  ╚══╝╚══╝ ╚═╝╚═╝     ╚═╝


/**
 * Sets up the WiFi connection.
 * 
 */
void setup_wifi() {
  delay(100);
  // We start by connecting to a WiFi network
  Serial.print("Connecting to ");
  Serial.println(ssid);
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  randomSeed(micros());
  Serial.println("");
  Serial.println("WiFi connected");
  Serial.print("IP address: ");
  Serial.println(WiFi.localIP());
}




// ███╗   ███╗ ██████╗ ████████╗████████╗
// ████╗ ████║██╔═══██╗╚══██╔══╝╚══██╔══╝
// ██╔████╔██║██║   ██║   ██║      ██║
// ██║╚██╔╝██║██║▄▄ ██║   ██║      ██║
// ██║ ╚═╝ ██║╚██████╔╝   ██║      ██║
// ╚═╝     ╚═╝ ╚══▀▀═╝    ╚═╝      ╚═╝


/**
 * Sets the MQTT broker connection up.
 * 
 */
void setup_mqtt() {
  client.setServer(mqtt_server, 1883);
  client.setCallback(callback); // callback function called when new data on any subscribed topic
}


/**
 * Callback method called on any subscribed topic's update.
 * 
 */
void callback(char* topic, byte* payload, unsigned int length) {
  Serial.print("Topic is : [");
  Serial.print(topic);
  Serial.print("] Payload: ");
  String myString = (char*) payload;  // converting the payload to raw string
  Serial.println(myString);
  String topicString = topic;
  
  if (topicString == "HiAlfredCommand/simple") {

    char p = (char)payload[0];

    Serial.println(p);
    switch (p) {

      case '0': {
          Serial.print(" Temperature is: " );
          float celsius = getTemperature();
          Serial.println(celsius);
          String msg = "";
          msg = msg + celsius;
          char message[6];
          msg.toCharArray(message, 6);
          client.publish("HiAlfredData/tmp", message);
        }
        break;
        
      case '3': {
          String status = "";
          status = status + digitalRead(LED_PIN);
          Serial.println("LED status is ");
          Serial.println(status);
          char message[4];
          status.toCharArray(message, 4);
          client.publish("HiAlfredData/led", message);
        }
        break;

      case '4': {
          switch_led();
        }
        break;

      default: {
        }
        break;
    }
  }

  else if (topicString == "HiAlfredCommand/set") {

    write_screen_message("Nouvelle", "temperature: " + myString);
  }
}


/**
 * Method aiming at connecting to MQTT broker and subscribing to topics.
 * 
 */
void mqtt_connect() {
  // Loop until we're connected
  while (!client.connected()) {
    Serial.print("Attempting MQTT connection...");
    // Create a random client ID
    String clientId = "ESP8266Client-";
    clientId += String(random(0xffff), HEX);
    // Attempt to connect
    //if you MQTT broker has clientID,username and password
    //please change following line to    if (client.connect(clientId,userName,passWord))
    if (client.connect(clientId.c_str())) {
      Serial.println("connected");
      //once connected to MQTT broker, subscribe to command if any
      client.subscribe("HiAlfredCommand/set");
      client.subscribe("HiAlfredCommand/simple");
    }
    else {
      Serial.print("failed, rc=");
      Serial.print(client.state());
      Serial.println(" try again in 5 seconds");
      // Wait 6 seconds before retrying
      delay(6000);
    }
  }
}




// ███╗   ██╗ ██████╗ ██████╗ ███████╗███╗   ███╗ ██████╗██╗   ██╗
// ████╗  ██║██╔═══██╗██╔══██╗██╔════╝████╗ ████║██╔════╝██║   ██║
// ██╔██╗ ██║██║   ██║██║  ██║█████╗  ██╔████╔██║██║     ██║   ██║
// ██║╚██╗██║██║   ██║██║  ██║██╔══╝  ██║╚██╔╝██║██║     ██║   ██║
// ██║ ╚████║╚██████╔╝██████╔╝███████╗██║ ╚═╝ ██║╚██████╗╚██████╔╝
// ╚═╝  ╚═══╝ ╚═════╝ ╚═════╝ ╚══════╝╚═╝     ╚═╝ ╚═════╝ ╚═════╝


/**
 * Sets up the NodeMCU.
 * 
 */
void setup() {

  Serial.begin(115200);
  setup_wifi();
  setup_mqtt();

  setup_screen();
  setup_led();
}


/**
 * Looping method.
 * 
 */
void loop() {
  if (!client.connected()) {
    mqtt_connect();
  }
  client.loop();
}


/**
 * Real-time temperature getter.
 * 
 */
float getTemperature() {
  int analogValue = analogRead(TMP_PIN);
  float millivolts = (analogValue / 1024.0) * 3300; //3300 is the voltage provided by NodeMCU
  float tmpCelsius = millivolts / 10;
  return tmpCelsius;
}




// ███████╗ ██████╗██████╗ ███████╗███████╗███╗   ██╗
// ██╔════╝██╔════╝██╔══██╗██╔════╝██╔════╝████╗  ██║
// ███████╗██║     ██████╔╝█████╗  █████╗  ██╔██╗ ██║
// ╚════██║██║     ██╔══██╗██╔══╝  ██╔══╝  ██║╚██╗██║
// ███████║╚██████╗██║  ██║███████╗███████╗██║ ╚████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚══════╝╚══════╝╚═╝  ╚═══╝


/**
 * Sets up the I2C screen.
 * 
 */
void setup_screen() {

  // The begin call takes the width and height. This
  // Should match the number provided to the I2C constructor.
  lcd.begin(16, 2);
  lcd.init();

  // Turn on the backlight.
  lcd.backlight();

  String tmp = String(getTemperature()) + 'C';
  write_screen_message("Temperature:", tmp);
  
  Serial.print("Temperature: ");
  Serial.println(tmp);
}


/**
 * Writes a message on the screen.
 * 
 */
void write_screen_message(String firstLine, String secondLine) {

  clear_screen();
  write_screen(0, 0, firstLine);
  write_screen(0, 1, secondLine);
}


/**
 * Writes a String at x and y position.
 * 
 */
void write_screen(int x, int y, String msg) {
  lcd.setCursor(x, y);
  lcd.print(msg);
}


/**
 * Clears the screen.
 * 
 */
void clear_screen() {
  String empty = "                ";
  write_screen(0, 0, empty);
  write_screen(0, 1, empty);
}




// ██╗     ███████╗██████╗
// ██║     ██╔════╝██╔══██╗
// ██║     █████╗  ██║  ██║
// ██║     ██╔══╝  ██║  ██║
// ███████╗███████╗██████╔╝
// ╚══════╝╚══════╝╚═════╝


/** 
 *  Sets up the LED.
 *  
 */
void setup_led() {

  pinMode(LED_PIN, OUTPUT);
  start_blink_led();
  /*
    Serial.println("the LED is currently: ");
    Serial.println(digitalRead(LED_PIN));
    Serial.println("");
    Serial.println("Switching the LED on...");
    switch_led_on();
    Serial.println("the LED is now: ");
    Serial.println(digitalRead(LED_PIN));
    Serial.println("");
  */
}


/**
 * Switches the LED ON or OFF depending on its status.
 * 
 */
void switch_led() {
  if (digitalRead(LED_PIN) == 0) {
    switch_led_on();
  }
  else {
    switch_led_off();
  }
}

void switch_led_on() {
  digitalWrite(LED_PIN, HIGH);
}

void switch_led_off() {
  digitalWrite(LED_PIN, LOW);
}


/**
 * Makes the LED blink for a few seconds.
 * 
 */
void start_blink_led() {

  digitalWrite(LED_PIN, HIGH);   // turn the LED on (HIGH is the voltage level)
  delay(100);                       // wait for a second
  digitalWrite(LED_PIN, LOW);    // turn the LED off by making the voltage LOW
  delay(100);
  digitalWrite(LED_PIN, HIGH);   // turn the LED on (HIGH is the voltage level)
  delay(100);                       // wait for a second
  digitalWrite(LED_PIN, LOW);    // turn the LED off by making the voltage LOW
  delay(100);
  digitalWrite(LED_PIN, HIGH);   // turn the LED on (HIGH is the voltage level)
  delay(100);                       // wait for a second
  digitalWrite(LED_PIN, LOW);    // turn the LED off by making the voltage LOW
  delay(100);
  digitalWrite(LED_PIN, HIGH);   // turn the LED on (HIGH is the voltage level)
  delay(100);                       // wait for a second
  digitalWrite(LED_PIN, LOW);    // turn the LED off by making the voltage LOW
  delay(100);
  digitalWrite(LED_PIN, HIGH);   // turn the LED on (HIGH is the voltage level)
  delay(100);
  digitalWrite(LED_PIN, LOW);    // turn the LED off by making the voltage LOW
}
