require('dotenv').config();
const express = require('express');
const { OpenAI } = require('openai');
const VoiceResponse = require('twilio').twiml.VoiceResponse;

const app = express();
const port = 3000;

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.use(express.urlencoded({ extended: false }));

// Enhanced debugging middleware
app.use((req, res, next) => {
  console.log(`\n[${new Date().toISOString()}] Incoming ${req.method} request to ${req.path}`);
  console.log('Request headers:', req.headers);
  console.log('Request body:', req.body);
  next();
});

// Twilio webhook endpoint
app.post('/voice', async (req, res) => {
  const twiml = new VoiceResponse();
  const callSid = req.body.CallSid;
  const callerNumber = req.body.From;
  
  console.log(`\n[${new Date().toISOString()}] New call from: ${callerNumber}`);
  console.log(`Call SID: ${callSid}`);

  try {
    const userInput = req.body.SpeechResult || '';
    console.log(`User input: "${userInput}"`);

    // Get response from OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {role: "system", content: `
          You are a helpful phone assistant for a pizza restaurant.
          The restaurant is open between 10-12 pm.
          You can help the customer reserve a table for the restaurant.
          You can also help the customer to order pizza.
          The restaurant is located at Delhi Pizza St.`},
        {role: "user", content: userInput}
      ],
      max_tokens: 100
    });

    const aiResponse = completion.choices[0].message.content;
    console.log(`AI response: "${aiResponse}"`);

    twiml.say(aiResponse);
    twiml.pause({ length: 1 });
    twiml.gather({
      input: 'speech',
      action: '/voice',
      speechTimeout: 'auto'
    });

  } catch (error) {
    console.error(`Error in call ${callSid}:`, error);
    twiml.say("Sorry, I encountered an error. Please try again later.");
  }

  res.type('text/xml');
  res.send(twiml.toString());
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}] Unhandled error:`, err);
  res.status(500).send('Internal Server Error');
});

app.listen(port, () => {
  console.log(`\nServer running on port ${port}`);
  console.log(`Twilio webhook URL: http://localhost:${port}/voice`);
  console.log('Press Ctrl+C to stop\n');
});