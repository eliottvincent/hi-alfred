#include <ESP8266WiFi.h>
#include <PubSubClient.h>

// Define NodeMCU A0 pin to as temperature data pin of tmp sensor
#define TMP_PIN A0
#define LED_PIN 13

// wifi and broker settings
const char* ssid = "Eliott's iPhone";
const char* password = "ntmmmmmm";
const char* mqtt_server = "broker.mqtt-dashboard.com";
//const char* mqtt_server = "iot.eclipse.org";

WiFiClient espClient;
PubSubClient client(espClient);
long lastMsg = 0;
char msg[50];
int value = 0;


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
  Serial.println("IP address: ");
  Serial.println(WiFi.localIP());
}


void callback(char* topic, byte* payload, unsigned int length) {
  Serial.print("Command is : [");
  Serial.print(topic);
  int p = (char)payload[0] - '0';
  // int chk = DHT.read11(DHT11_PIN);
  // if MQTT comes a 0 message, show humidity
  if (p == 0) {
    Serial.println("to show temperature!]");
    Serial.print(" Temperature is: " );
    float celsius = getTemperature();
    Serial.println(celsius);
    String msg = "";
    msg = msg + celsius;
    char message[6];
    msg.toCharArray(message, 6);
    client.publish("HiAlfredData", message);
  }

  // if MQTT comes a 1 message, show temperature
  if (p == 1) {
    digitalWrite(LED_PIN, HIGH);
    Serial.println(" is to switch LED!] ");
    
  }
  Serial.println();
} //end callback

void reconnect() {
  // Loop until we're reconnected
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
      client.subscribe("HiAlfredCommand");
    }
    else {
      Serial.print("failed, rc=");
      Serial.print(client.state());
      Serial.println(" try again in 5 seconds");
      // Wait 6 seconds before retrying
      delay(6000);
    }
  }
} //end reconnect()

void setup() {
  Serial.begin(115200);
  setup_wifi();
  client.setServer(mqtt_server, 1883);
  client.setCallback(callback);
  Serial.print(" Starting Temparature ");
  float celsius = getTemperature();
  Serial.print(celsius);
  Serial.println('C');
}

void loop() {
  if (!client.connected()) {
    reconnect();
  }
  client.loop();
  /*
  long now = millis();
  // reading temperature sensor every 5 seconds
  if (now - lastMsg > 5000) {

    lastMsg = now;

    String msg = "";
    msg = msg + getTemperature();

    char message[58];
    msg.toCharArray(message, 58);

    Serial.println(message);

    //publishing the data to MQTT "HiAlfredData" topic
    client.publish("HiAlfredData", message);
  }
  */
}

float getTemperature() {
  int analogValue = analogRead(TMP_PIN);
  float millivolts = (analogValue / 1024.0) * 3300; //3300 is the voltage provided by NodeMCU
  float tmpCelsius = millivolts / 10;
  return tmpCelsius;
}
