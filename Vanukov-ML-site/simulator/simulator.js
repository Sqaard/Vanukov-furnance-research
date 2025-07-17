import { WebSocketServer } from 'ws';
import * as fs from 'fs';
import { dirname, join } from 'path';
import {parse} from 'csv-parse'
import { fileURLToPath } from 'url';

//init server
const wss = new WebSocketServer({ port: 5001 });
console.log('WebSocket server is running on ws://0.0.0.0:5001');

// Получаем __dirname в ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Column translations
const columnTranslations = {
    'номер измерения': 'Measurement ID',
    'дата': 'Date',
    'давление КВС, точка1': 'blast furnace pressure, point 1',
    'давление КВС, точка2': 'blast furnace pressure, point 2',
    'давление природный газ': 'natural gas pressure',
    'конвейер 31, производительность': 'conveyor 31, productivity',
    'конвейер 31, скорость': 'conveyor 31, speed',
    'конвейер 32, производительность': 'conveyor 32, productivity',
    'конвейер 32, скорость': 'conveyor 32, speed',
    'питатель1, уровень': 'feeder 1, level',
    'питатель1, скорость': 'feeder 1, speed',
    'питатель1, производительность': 'feeder 1, productivity',
    'питатель2, уровень': 'feeder 2, level',
    'питатель2, скорость': 'feeder 2, speed',
    'питатель2, производительность': 'feeder 2, productivity',
    'питатель3, уровень': 'feeder 3, level',
    'питатель3, скорость': 'feeder 3, speed',
    'питатель3, производительность': 'feeder 3, productivity',
    'питатель4, уровень': 'feeder 4, level',
    'питатель4, скорость': 'feeder 4, speed',
    'питатель4, производительность': 'feeder 4, productivity',
    'питатель5, уровень': 'feeder 5, level',
    'питатель5, скорость': 'feeder 5, speed',
    'питатель5, производительность': 'feeder 5, productivity',
    'питатель6, уровень': 'feeder 6, level',
    'питатель6, скорость': 'feeder 6, speed',
    'питатель6, производительность': 'feeder 6, productivity',
    'питатель7, скорость': 'feeder 7, speed',
    'питатель8, скорость': 'feeder 8, speed',
    'питатель7, уровень': 'feeder 7, level',
    'питатель8, уровень': 'feeder 8, level',
    'разрежение в аптейке': 'vacuum in the bunker',
    'расход КВС': 'blast furnace flow',
    'расход природного газа': 'natural gas flow',
    'содержание кислорода в КВС': 'oxygen content in the blast furnace',
    'температура КВС': 'blast furnace temperature',
    'температура отходящих газов в аптейке': 'temperature of outgoing gases in the bunker',
    'температура пода, шлаковый сифон': 'temperature of the feed, slag siphon',
    'температура пода, штейновый сифон': 'temperature of the feed, matte siphon',
    'температура пода, зона плавления, точка1': 'temperature of the feed, melting zone, point 1',
    'температура пода, зона плавления, точка2': 'temperature of the feed, melting zone, point 2',
    'температура природного газа': 'temperature of natural gas',
};

function loadCSV(filePath) {
    return new Promise((resolve, reject) => {
        const results = [];
        fs.createReadStream(filePath)
            .pipe(parse({ columns: true, skip_lines: 2 }))
            .on('data', (row) => results.push(row))
            .on('end', () => resolve(results))
            .on('error', (err) => reject(err));
    });
}

async function loadAndPreprocessData() {
    try {
        // Load CSV files
        const data1 = await loadCSV(join(__dirname, 'data/data1.csv'));
        const data2 = await loadCSV(join(__dirname, 'data/data2.csv'));
        const data3 = await loadCSV(join(__dirname, 'data/data3.csv'));

        // Rename columns
        const renameColumns = (data) => {
            return data.map(row => {
                const newRow = {};
                for (const key in row) {
                    newRow[columnTranslations[key] || key] = row[key];
                }
                return newRow;
            });
        };

        // Merge data
        let data = [...data1, ...data2, ...data3];
        data = renameColumns(data)
        // Convert Date and filter out invalid rows
        data = data
            .map(row => ({
                ...row,
                Date: new Date(row.Date).toString() !== 'Invalid Date' ? row.Date : null
            }))
            .filter(row => row.Date !== null);

        data = data.map(row => ({
        ...row,
        'Total charge rate, t/h': Number(row['conveyor 31, productivity']) + Number(row['conveyor 32, productivity']) || 0,
        'Temperature of feed in the smelting zone, °C': (
            (Number(row['temperature of the feed, melting zone, point 1']) || 0) +
            (Number(row['temperature of the feed, melting zone, point 2']) || 0)
        ) / 2,
        'Temperature of exhaust gases in the off-gas duct, °C': Number(row['temperature of outgoing gases in the bunker']) || 0,
        'Overall blast volume, m3/h': Number(row['blast furnace flow']) || 0,
        'Oxygen content in the blast (degree of oxygen enrichment in the blowing), %': Number(row['oxygen content in the blast furnace']) || 0,
        'feeder 2, speed': Number(row['feeder 2, speed']) || 0,
        }));

        return data;
    } catch (error) {
        console.error('Error in data preprocessing:', error);
        throw error;
  }
}

async function simulateFurnace(ws) {
    try {
        const data = await loadAndPreprocessData();
        for (const row of data) {
            if (ws.readyState === 1) { // WebSocket.OPEN
                ws.send(JSON.stringify(row));
                await new Promise(resolve => setTimeout(resolve, 1000)); // 1-second delay
            } else {
                console.log('WebSocket connection closed, stopping simulation');
                break;
            }
        }
    } catch (error) {
        console.error('Error in simulateFurnace:', error);
    }
}

// Handle WebSocket connections
wss.on('connection', (ws) => {
    console.log('New WebSocket connection');

    // Start simulation for this client
    simulateFurnace(ws);

    ws.on('close', () => {
        console.log('WebSocket connection closed');
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});