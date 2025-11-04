// --- Firebase Imports and Setup ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Global Firebase instances
window.db = null;
window.auth = null;
window.userId = null;
window.appId = null;

// Firebase Initialization and Authentication
async function setupFirebaseAndAuth() {
    try {
        const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
        const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
        window.appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

        if (firebaseConfig) {
            const app = initializeApp(firebaseConfig);
            window.db = getFirestore(app);
            window.auth = getAuth(app);

            if (initialAuthToken) {
                await signInWithCustomToken(window.auth, initialAuthToken);
            } else {
                await signInAnonymously(window.auth);
            }
            window.userId = window.auth.currentUser?.uid || crypto.randomUUID();
        }
    } catch (error) {
        console.error("Firebase setup failed:", error);
    }
}

window.setupFirebaseAndAuth = setupFirebaseAndAuth;

// --- API Configuration ---
const API_KEY = "AIzaSyDGvSpVUm4nzeEm9GBGb7x-0zVCs7QhQyw"; // Leave as-is
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${API_KEY}`;

// --- Utility Functions ---

// Simple markdown to HTML conversion for display
function renderMarkdown(markdownText) {
    // Convert bold and list items to simple HTML for readability
    let html = markdownText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/^#+ (.*$)/gim, '<h3>$1</h3>'); // Convert MD headers
    html = html.replace(/^\* (.*$)/gim, '<li>$1</li>'); // Convert MD lists
    // Replace markdown lists with HTML <ul> tags
    html = html.replace(/(<li>.*<\/li>(\s*<br>)?)+/gms, (match) => {
        let content = match.replace(/<br>$/, '');
        return `<ul class="list-disc list-inside ml-4 space-y-1">${content}</ul>`;
    });
    // Basic line break conversion
    html = html.replace(/\n\n/g, '<p></p>');
    html = html.replace(/\n/g, '<br>');

    return html;
}

// Exponential backoff for API calls
async function callApiWithBackoff(url, options, maxRetries = 5) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(url, options);
            if (response.status === 429 && i < maxRetries - 1) {
                const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
                continue; // Retry
            }
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        } catch (error) {
            if (i === maxRetries - 1) throw error; // Throw after final attempt
            const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}


// --- Core Application Logic ---

document.addEventListener('DOMContentLoaded', async () => {
    await setupFirebaseAndAuth();
    const statusElement = document.getElementById('auth-status');
    if (window.userId) {
        statusElement.textContent = `User ID: ${window.userId}`;
        statusElement.classList.add('text-green-600');
    } else {
        statusElement.textContent = `Authentication Failed.`;
        statusElement.classList.add('text-red-600');
    }
});

async function generatePlan() {
    const goal = document.getElementById('study-goal').value.trim();
    const days = document.getElementById('total-days').value;
    const hours = document.getElementById('hours-per-day').value;
    const outputElement = document.getElementById('plan-output');
    const button = document.getElementById('generate-button');
    const sourcesContainer = document.getElementById('sources-container');
    const sourcesList = document.getElementById('sources-list');

    if (!goal || !days || !hours) {
        outputElement.innerHTML = `<span class="text-red-500">Please fill in all fields (Study Goal, Days, and Hours).</span>`;
        return;
    }

    // UI feedback for processing
    button.disabled = true;
    button.innerHTML = `
        <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        Generating Plan...
    `;
    outputElement.innerHTML = `
        <div class="flex items-center space-x-2 text-gray-500">
            <svg class="animate-bounce h-5 w-5" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm1 16H8V8h5v10zm-3-2v-6h1v6h-1z" fill="currentColor"/></svg>
            <span>Thinking... breaking down your goal into actionable steps.</span>
        </div>
    `;
    sourcesContainer.classList.add('hidden');
    sourcesList.innerHTML = '';


    // --- Gemini API Setup ---

    const systemPrompt = `You are an expert, encouraging AI Study Planner and Tutor. Your goal is to create a detailed, actionable, and time-bound study schedule based on the user's input. 
    Format the entire response clearly using Markdown headings (for days), bold text, and numbered or bulleted lists. 
    Ensure the plan is broken down into manageable sessions that fit the 'Hours Per Day' constraint. 
    Do not include any introductory or concluding conversational text, just the plan itself.`;

    const userQuery = `Create a complete study schedule.
    The Study Goal is: "${goal}".
    The Total Duration is: ${days} days.
    The Time available per day is: ${hours} hours.
    Make sure to structure the plan by day, and include specific topics and estimated time for each session within the daily limit.`;

    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        tools: [{ "google_search": {} }], // Enable grounding for current topics/concepts
        systemInstruction: {
            parts: [{ text: systemPrompt }]
        },
    };

    try {
        const responseJson = await callApiWithBackoff(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const candidate = responseJson.candidates?.[0];

        if (candidate && candidate.content?.parts?.[0]?.text) {
            const text = candidate.content.parts[0].text;
            outputElement.innerHTML = renderMarkdown(text);

            // Extract and display grounding sources
            let sources = [];
            const groundingMetadata = candidate.groundingMetadata;
            if (groundingMetadata && groundingMetadata.groundingAttributions) {
                sources = groundingMetadata.groundingAttributions
                    .map(attribution => ({
                        uri: attribution.web?.uri,
                        title: attribution.web?.title,
                    }))
                    .filter(source => source.uri && source.title);

                if (sources.length > 0) {
                    sourcesContainer.classList.remove('hidden');
                    sources.forEach(source => {
                        const listItem = document.createElement('li');
                        listItem.innerHTML = `<a href="${source.uri}" target="_blank" class="text-primary-blue hover:underline">${source.title}</a>`;
                        sourcesList.appendChild(listItem);
                    });
                }
            }

        } else {
            outputElement.innerHTML = `<span class="text-red-500">Failed to generate a plan. Please try a different goal or parameters.</span>`;
        }

    } catch (error) {
        console.error("API Call Error:", error);
        outputElement.innerHTML = `<span class="text-red-500">An error occurred while connecting to the AI. Please check your console for details.</span>`;
    } finally {
        // Restore button state
        button.disabled = false;
        button.innerHTML = `<svg id="button-icon" class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg><span>Generate Study Plan</span>`;
    }
}

// Make the function accessible from the HTML onclick attribute
window.generatePlan = generatePlan;
document.addEventListener('DOMContentLoaded', async () => {
    // ... calls setupFirebaseAndAuth() ...
    const statusElement = document.getElementById('auth-status');
    if (window.userId) {
        // success state
    } else {
        statusElement.textContent = `Authentication Failed.`; // This line is running
        statusElement.classList.add('text-red-600');
    }
});