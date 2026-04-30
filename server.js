const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');

const ROOT_DIR = __dirname;
const INDEX_PATH = path.join(ROOT_DIR, 'index.html');
const ENV_PATH = path.join(ROOT_DIR, '.env');
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 3000);

function logServerError(scope, error, extra = {}) {
    console.error(`[${scope}]`, error && error.stack ? error.stack : error, extra);
}

function parseEnvFile(filePath) {
    if (!fs.existsSync(filePath)) {
        return {};
    }

    const env = {};
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) {
            continue;
        }

        const separatorIndex = line.indexOf('=');
        if (separatorIndex === -1) {
            continue;
        }

        const key = line.slice(0, separatorIndex).trim();
        let value = line.slice(separatorIndex + 1).trim();

        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        env[key] = value;
    }

    return env;
}

function getAppConfig() {
    const env = {
        ...parseEnvFile(ENV_PATH),
        ...process.env
    };

    const dashboardProxyTemplates = [
        env.DASHBOARD_PROXY_1,
        env.DASHBOARD_PROXY_2,
        env.DASHBOARD_PROXY_3
    ].filter(Boolean);

    return {
        dashboardTargetUrl: env.DASHBOARD_TARGET_URL || '',
        dashboardProxyTemplates
    };
}

function validateAppConfig(config) {
    const errors = [];

    if (!config.dashboardTargetUrl) {
        errors.push('DASHBOARD_TARGET_URL belum diisi.');
    }

    if (!Array.isArray(config.dashboardProxyTemplates) || !config.dashboardProxyTemplates.length) {
        errors.push('Minimal satu DASHBOARD_PROXY_* harus diisi.');
    }

    return errors;
}

function injectConfig(html) {
    const configScript = `<script>window.APP_CONFIG = ${JSON.stringify(getAppConfig())};</script>`;
    const defaultConfigScript = '<script>\n        window.APP_CONFIG = window.APP_CONFIG || {\n            dashboardTargetUrl: \'\',\n            dashboardProxyTemplates: []\n        };\n    </script>';

    if (html.includes(defaultConfigScript)) {
        return html.replace(defaultConfigScript, configScript);
    }

    return html.replace('</head>', `    ${configScript}\n</head>`);
}

function sendHtml(res) {
    try {
        const html = fs.readFileSync(INDEX_PATH, 'utf8');
        const configErrors = validateAppConfig(getAppConfig());
        if (configErrors.length) {
            logServerError('config', new Error('Invalid app config'), { configErrors });
        }

        const withConfig = injectConfig(html);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(withConfig);
    } catch (error) {
        logServerError('sendHtml', error);
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Internal Server Error');
    }
}

function sendNotFound(res) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
}

const server = http.createServer((req, res) => {
    try {
        const requestUrl = new URL(req.url, `http://${req.headers.host}`);
        const pathname = requestUrl.pathname;

        if (pathname === '/' || pathname === '/index.html') {
            sendHtml(res);
            return;
        }

        sendNotFound(res);
    } catch (error) {
        logServerError('request-handler', error, { url: req.url });
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Internal Server Error');
    }
});

server.on('clientError', (error, socket) => {
    logServerError('clientError', error);
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

server.listen(PORT, HOST, () => {
    console.log(`Server ready at http://${HOST}:${PORT}`);
});

server.on('error', (error) => {
    logServerError('server', error, { host: HOST, port: PORT });
    process.exitCode = 1;
});

process.on('uncaughtException', (error) => {
    logServerError('uncaughtException', error);
    process.exitCode = 1;
});

process.on('unhandledRejection', (reason) => {
    logServerError('unhandledRejection', reason instanceof Error ? reason : new Error(String(reason)));
    process.exitCode = 1;
});
