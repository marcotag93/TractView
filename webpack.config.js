//@ts-check
'use strict';

const path = require('path');

/** @type {import('webpack').Configuration[]} */
const config = [
    // Extension (Node.js)
    {
        name: 'extension',
        target: 'node',
        mode: 'none',
        entry: './src/extension.ts',
        output: {
            path: path.resolve(__dirname, 'dist'),
            filename: 'extension.js',
            libraryTarget: 'commonjs2'
        },
        externals: {
            vscode: 'commonjs vscode',
            zlib: 'commonjs zlib'
        },
        resolve: {
            extensions: ['.ts', '.js']
        },
        module: {
            rules: [
                {
                    test: /\.ts$/,
                    exclude: /node_modules/,
                    use: [
                        {
                            loader: 'ts-loader'
                        }
                    ]
                }
            ]
        },
        devtool: 'nosources-source-map',
        infrastructureLogging: {
            level: 'log'
        }
    },
    // WebView (Browser)
    {
        name: 'webview',
        target: 'web',
        mode: 'none',
        entry: './src/webview/main.ts',
        output: {
            path: path.resolve(__dirname, 'dist', 'webview'),
            filename: 'main.js'
        },
        resolve: {
            extensions: ['.ts', '.js']
        },
        module: {
            rules: [
                {
                    test: /\.ts$/,
                    exclude: /node_modules/,
                    use: [
                        {
                            loader: 'ts-loader'
                        }
                    ]
                },
                {
                    test: /\.css$/,
                    use: ['style-loader', 'css-loader']
                }
            ]
        },
        devtool: 'nosources-source-map'
    }
];

module.exports = config;
