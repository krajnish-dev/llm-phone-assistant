const express = require('express');
const OpenAI = require('openai');
const { twiml } = require('twilio');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');
const ngrok = require('@ngrok/ngrok');

dotenv.config();

const app = express();
const openAI = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const GREETING_MESSAGE = 'Hello, how are you?';

app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.get('/', (req, res) => {
    const currentTime = new Date().toLocaleString();
    console.log('Current Time: ' + currentTime);
    res.send('<h1>Welcome to Test Page</h1>');
});

app.post('/incoming-call', (req, res) => {
    const voiceResponse = new twiml.VoiceResponse();
    let messages = req.cookies.messages ? JSON.parse(req.cookies.messages) : null;

    if (!messages) {
        messages = [
            {
                role: "system",
                content: `You are a helpful phone assistant for Concret.io, a Salesforce consulting company.
                          Your name is Concret Assistant.
                          You are a friendly and knowledgeable assistant.
                          The company operates between 10:00 AM and 07:00 PM.
                          You assist customers in creating Salesforce-based solutions.
                          You also provide IT companies with expert services to resolve their technical issues.
                          The company is located in Gurugram, India.`
            },
            {
                role: "assistant",
                content: GREETING_MESSAGE
            }
        ];
        res.cookie('messages', JSON.stringify(messages));
        voiceResponse.say(GREETING_MESSAGE);
    }

    voiceResponse.gather({
        input: ['speech'],
        speechTimeout: 'auto',
        speechModel: 'experimental_conversations',
        enhanced: true,
        action: '/respond',
        method: 'POST'
    });

    res.type('text/xml');
    res.send(voiceResponse.toString());
});

app.post('/respond', async (req, res) => {
    const voiceInput = req.body.SpeechResult;
    let messages = req.cookies.messages ? JSON.parse(req.cookies.messages) : [];

    messages.push({ role: "user", content: voiceInput });

    try {
        const chatCompletion = await openAI.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages,
            temperature: 0
        });

        const assistantResponse = chatCompletion.choices[0].message.content;
        messages.push({ role: "assistant", content: assistantResponse });
        res.cookie('messages', JSON.stringify(messages));

        const voiceResponse = new twiml.VoiceResponse();
        voiceResponse.say(assistantResponse);
        voiceResponse.redirect({ method: "POST" }, "/incoming-call");

        res.type('text/xml');
        res.send(voiceResponse.toString());
    } catch (error) {
        console.error("OpenAI API Error:", error);
        res.status(500).send("Error processing request");
    }
});

const port = process.env.PORT || 3000;

app.listen(port, async () => {
    console.log(`Server is running on: http://localhost:${port}`);

    // Start ngrok tunnel if enabled
    if (process.env.NGROK_AUTH_TOKEN) {
        const NGROK_AUTH_TOKEN = process.env.NGROK_AUTH_TOKEN;
        try {
            const listener = await ngrok.forward({
                addr: port,
                authtoken: NGROK_AUTH_TOKEN,
            });

            console.log({
                urls: listener.url(),
            });

            console.log(`Ngrok tunnel established at: ${listener.url()}`);
        } catch (err) {
            console.error('Error establishing ngrok tunnel:', err);
        }
    }
    else {
        console.log('Ngrok is not enabled. Set NGROK_AUTH_TOKEN in .env to enable it.');
    }
});
