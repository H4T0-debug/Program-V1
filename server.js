const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;

// Primary & Fallback Piston Endpoints
const PISTON_PRIMARY = 'https://emmy-piston.vercel.app/api/v2';
const PISTON_FALLBACK = 'https://emkc.org/api/v2/piston';

app.use(cors());
app.use(express.json());

// Mapping for Glot.io language identifiers
const GLOT_LANG_MAP = {
    'cpp': 'cpp',
    'c++': 'cpp',
    'c': 'c',
    'python': 'python',
    'py': 'python',
    'python3': 'python',
    'javascript': 'javascript',
    'js': 'javascript',
    'node': 'javascript',
    'java': 'java',
    'go': 'go',
    'rust': 'rust'
};

// Default runtimes fallback list
const DEFAULT_RUNTIMES = [
    { language: 'javascript', version: 'node.js', aliases: ['js', 'node'] },
    { language: 'python', version: '3.x', aliases: ['py', 'python3'] },
    { language: 'cpp', version: 'gcc', aliases: ['c++', 'g++'] },
    { language: 'c', version: 'gcc', aliases: ['gcc'] }
];

// Root Health Check Route
app.get('/', (req, res) => {
    res.json({ status: 'online', service: 'Program-V1 Roblox Bridge' });
});

/**
 * Helper function to execute code via Glot.io API
 */
async function executeGlot(language, code) {
    const langLower = language.toLowerCase();
    const glotLang = GLOT_LANG_MAP[langLower];

    if (!glotLang) {
        throw new Error(`Glot.io does not support language: ${language}`);
    }

    let fileName = 'main.txt';
    if (glotLang === 'cpp') fileName = 'main.cpp';
    else if (glotLang === 'c') fileName = 'main.c';
    else if (glotLang === 'python') fileName = 'main.py';
    else if (glotLang === 'javascript') fileName = 'main.js';
    else if (glotLang === 'java') fileName = 'Main.java';
    else if (glotLang === 'go') fileName = 'main.go';

    const response = await axios.post(
        `https://glot.io/api/run/${glotLang}/latest`,
        {
            files: [
                {
                    name: fileName,
                    content: code
                }
            ]
        },
        {
            headers: { 'Content-Type': 'application/json' },
            timeout: 15000
        }
    );

    const stdout = response.data.stdout || '';
    const stderr = response.data.stderr || response.data.error || '';

    return {
        output: stdout || stderr || 'Code executed with no output.',
        stderr: stderr,
        code: stderr ? 1 : 0
    };
}

/**
 * Helper function to run code locally on host instance (JS/Python only)
 */
function executeLocally(language, code) {
    return new Promise((resolve, reject) => {
        const langLower = language.toLowerCase();
        let command = '';

        if (langLower === 'js' || langLower === 'javascript' || langLower === 'node') {
            command = `node -e ${JSON.stringify(code)}`;
        } else if (langLower === 'py' || langLower === 'python' || langLower === 'python3') {
            command = `python3 -c ${JSON.stringify(code)}`;
        } else {
            return reject(new Error(`Local host execution only supports JS and Python. '${language}' requires remote compiler.`));
        }

        exec(command, { timeout: 5000 }, (error, stdout, stderr) => {
            if (error && error.killed) {
                return resolve({
                    output: 'Execution Timed Out (5s limit reached).',
                    stderr: 'TimeoutError: Process was killed after 5 seconds.'
                });
            }
            resolve({
                output: stdout || stderr || (error ? error.message : 'Code executed with no output.'),
                stderr: stderr || (error ? error.message : '')
            });
        });
    });
}

/**
 * GET /runtimes
 */
app.get('/runtimes', async (req, res) => {
    try {
        const response = await axios.get(`${PISTON_PRIMARY}/runtimes`, { timeout: 10000 });
        res.json({ success: true, runtimes: response.data });
    } catch (error) {
        console.warn('Primary Piston runtimes failed, trying fallback...');
        try {
            const fallbackRes = await axios.get(`${PISTON_FALLBACK}/runtimes`, { timeout: 10000 });
            res.json({ success: true, runtimes: fallbackRes.data });
        } catch (fallbackErr) {
            console.error('All runtimes endpoints failed. Serving default list.');
            res.json({ success: true, runtimes: DEFAULT_RUNTIMES });
        }
    }
});

/**
 * POST /execute
 */
app.post('/execute', async (req, res) => {
    const { language, version, code } = req.body;

    if (!language || !code) {
        return res.status(400).json({ 
            success: false, 
            error: 'Missing required parameters: "language" or "code".' 
        });
    }

    const pistonPayload = {
        language: language,
        version: version || '*',
        files: [{ content: code }]
    };

    // 1. Try Primary Piston
    try {
        const response = await axios.post(`${PISTON_PRIMARY}/execute`, pistonPayload, {
            timeout: 15000,
            headers: { 'Content-Type': 'application/json' }
        });

        return res.json({
            success: true,
            language: response.data.language,
            version: response.data.version,
            output: response.data.run?.output || 'Code executed with no output.',
            code: response.data.run?.code, 
            stderr: response.data.run?.stderr
        });

    } catch (primaryError) {
        console.warn('Primary Piston API failed, trying Fallback Piston...');

        // 2. Try Fallback Piston
        try {
            const fallbackResponse = await axios.post(`${PISTON_FALLBACK}/execute`, pistonPayload, {
                timeout: 15000,
                headers: { 'Content-Type': 'application/json' }
            });

            return res.json({
                success: true,
                language: fallbackResponse.data.language,
                version: fallbackResponse.data.version,
                output: fallbackResponse.data.run?.output || 'Code executed with no output.',
                code: fallbackResponse.data.run?.code,
                stderr: fallbackResponse.data.run?.stderr
            });

        } catch (fallbackError) {
            console.warn('Piston APIs unavailable. Trying Glot.io API...');

            // 3. Try Glot.io API (Fixes C++, C, Java, etc.)
            try {
                const glotResult = await executeGlot(language, code);
                return res.json({
                    success: true,
                    language: language,
                    version: 'glot-latest',
                    output: glotResult.output,
                    code: glotResult.code,
                    stderr: glotResult.stderr
                });

            } catch (glotError) {
                console.warn('Glot.io failed. Attempting direct local host execution...');

                // 4. Try Local Host Execution (JS / Python only)
                try {
                    const localResult = await executeLocally(language, code);
                    return res.json({
                        success: true,
                        language: language,
                        version: 'local-node',
                        output: localResult.output,
                        code: 0,
                        stderr: localResult.stderr
                    });
                } catch (localErr) {
                    console.error('All compiler methods failed.');
                    return res.status(500).json({ 
                        success: false, 
                        error: `Execution failed: ${localErr.message}` 
                    });
                }
            }
        }
    }
});

app.listen(PORT, () => {
    console.log(`Program-V1 Backend running on port ${PORT}`);
});