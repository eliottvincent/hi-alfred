/*************************************************************
  Download latest Blynk library here:
    https://github.com/blynkkk/blynk-library/releases/latest

  Blynk is a platform with iOS and Android apps to control
  Arduino, Raspberry Pi and the likes over the Internet.
  You can easily build graphic interfaces for all your
  projects by simply dragging and dropping widgets.

    Downloads, docs, tutorials: http://www.blynk.cc
    Sketch generator:           http://examples.blynk.cc
    Blynk community:            http://community.blynk.cc
    Follow us:                  http://www.fb.com/blynkapp
                                http://twitter.com/blynk_app

  Blynk library is licensed under MIT license
  This example code is in public domain.

 *************************************************************

  You’ll need:
   - Blynk App (download from AppStore or Google Play)
   - NodeMCU board
   - Decide how to connect to Blynk
     (USB, Ethernet, Wi-Fi, Bluetooth, ...)

  There is a bunch of great example sketches included to show you how to get
  started. Think of them as LEGO bricks  and combine them as you wish.
  For example, take the Ethernet Shield sketch and combine it with the
  Servo example, or choose a USB sketch and add a code from SendData
  example.
 *************************************************************/

/* Comment this out to disable prints and save space */
#define BLYNK_PRINT Serial


#include <ESP8266WiFi.h>
#include <BlynkSimpleEsp8266.h>

// You should get Auth Token in the Blynk App.
// Go to the Project Settings (nut icon).
char auth[] = "6b5793f23a854718b45464a6dd7fa9dc";

// Your WiFi credentials.
// Set password to "" for open networks.
char ssid[] = "Eliott's iPhone";
char pass[] = "ntmmmmmm";
// char ssid[] = "Livebox-B250_5GHz";
// char pass[] = "dHzfoWW5NNdxunZtSx";

int outputpin = A0;  //initializes/defines the output pin of the LM35 temperature sensor
                    //this sets the ground pin to LOW and the input voltage pin to high


void setup()
{
  // Debug console
  Serial.begin(9600);

  Serial.write("Hello");

  Blynk.begin(auth, ssid, pass);
  // You can also specify server:
  //Blynk.begin(auth, ssid, pass, "blynk-cloud.com", 8442);
  //Blynk.begin(auth, ssid, pass, IPAddress(192,168,1,100), 8442);


  pinMode(D8, OUTPUT); 
}

void loop()
{
  Blynk.run();

  int analogValue = analogRead(outputpin);
  float millivolts = (analogValue/1024.0) * 3300; //3300 is the voltage provided by NodeMCU
  float celsius = millivolts/10;
  Serial.print("in DegreeC=   ");
  Serial.println(celsius);

  Blynk.virtualWrite(V0, celsius);

  
  delay(1000);
   
  
  // You can inject your own code or combine it with other sketches.
  // Check other examples on how to communicate with Blynk. Remember
  // to avoid delay() function!
}

BLYNK_WRITE(V1)
{   
  int value = param.asInt(); // Get value as integer
  digitalWrite(D8,value);
}


