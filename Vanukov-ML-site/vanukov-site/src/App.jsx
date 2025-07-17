import React, { useState, useEffect } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import axios from 'axios';
import './App.css';

const App = () => {
  const [data, setData] = useState([]);
  const [cuPredictions, setCuPredictions] = useState([]);
  const [error, setError] = useState(null);
  const [currentValues, setCurrentValues] = useState({});
  const [recommendations, setRecommendations] = useState([]);
  const [manualAdjustments, setManualAdjustments] = useState({
    'Overall blast volume, m3/h': null,
    'feeder 2, speed': null,
  });
  const [inputValues, setInputValues] = useState({
    'Overall blast volume, m3/h': '',
    'feeder 2, speed': '',
  });
  const [lastRecommendationTime, setLastRecommendationTime] = useState(0);

  // Normative ranges for input validation
  const normativeRanges = {
    'Overall blast volume, m3/h': { min: 800, max: 1200 },
    'feeder 2, speed': { min: 15, max: 45 },
  };

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:5001');

    ws.onopen = () => {
      console.log('WebSocket connected to ws://localhost:5001');
    };

    ws.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('WebSocket message:', message);
        const time = new Date(message.Date).toLocaleTimeString();
        const newData = {
          time,
          overallBlastVolume: Number(message['Overall blast volume, m3/h']) || 0,
          tempFeedMatteSiphon: Number(message['temperature of the feed, matte siphon']) || 0,
          tempFeedMeltingZonePoint1: Number(message['temperature of the feed, melting zone, point 1']) || 0,
          naturalGasFlow: Number(message['natural gas flow']) || 0,
          feeder2Speed: Number(message['feeder 2, speed']) || 0,
        };

        const requiredFeatures = [
          'Total charge rate, t/h',
          'Overall blast volume, m3/h',
          'Oxygen content in the blast (degree of oxygen enrichment in the blowing), %',
          'Temperature of exhaust gases in the off-gas duct, °C',
          'Temperature of feed in the smelting zone, °C',
          'feeder 2, speed',
        ];
        const predictData = {
          'Total charge rate, t/h': Number(message['Total charge rate, t/h']) || 100,
          'Overall blast volume, m3/h': manualAdjustments['Overall blast volume, m3/h'] !== null ? manualAdjustments['Overall blast volume, m3/h'] : Number(message['Overall blast volume, m3/h']) || 1000,
          'Oxygen content in the blast (degree of oxygen enrichment in the blowing), %': Number(message['Oxygen content in the blast (degree of oxygen enrichment in the blowing), %']) || 21,
          'Temperature of exhaust gases in the off-gas duct, °C': Number(message['Temperature of exhaust gases in the off-gas duct, °C']) || 500,
          'Temperature of feed in the smelting zone, °C': Number(message['Temperature of feed in the smelting zone, °C']) || 1000,
          'feeder 2, speed': manualAdjustments['feeder 2, speed'] !== null ? manualAdjustments['feeder 2, speed'] : Number(message['feeder 2, speed']) || 30,
        };

        setData((prev) => [...prev, newData].slice(-100));


        try {
          const [predictResponse, recommendResponse] = await Promise.all([
            axios.post('http://localhost:5002/predict', predictData),
            axios.post('http://localhost:5002/recommend', predictData)
          ]);
          const cuPrediction = predictResponse.data.prediction;
          const { current_cu, recommendations: newRecommendations } = recommendResponse.data;

          setCuPredictions((prev) => [...prev, { time, cu: cuPrediction }].slice(-100));
          setCurrentValues({
            overallBlastVolume: predictData['Overall blast volume, m3/h'],
            tempFeedMatteSiphon: newData.tempFeedMatteSiphon,
            tempFeedMeltingZonePoint1: newData.tempFeedMeltingZonePoint1,
            naturalGasFlow: newData.naturalGasFlow,
            feeder2Speed: predictData['feeder 2, speed'],
            cu: cuPrediction,
          });

          const currentTime = Date.now();
          if (currentTime - lastRecommendationTime >= 5000) {
            setRecommendations(newRecommendations);
            setLastRecommendationTime(currentTime);
          }

          setError(null);
        } catch (error) {
          console.error('Error fetching prediction or recommendations:', error.response?.data || error.message);
          setError(`Ошибка предсказания или рекомендаций: ${error.response?.data?.error || error.message}`);
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
        setError(`Ошибка сообщения WebSocket: ${error.message}`);
      }
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setError('Соединение WebSocket закрыто');
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      setError(`Ошибка WebSocket: ${error.message}`);
    };

    return () => ws.close();
  }, [manualAdjustments, lastRecommendationTime]);

  const handleInputChange = (param, value) => {
    setInputValues((prev) => ({ ...prev, [param]: value }));
  };

  const applyAdjustment = async (param) => {
    const value = parseFloat(inputValues[param]);
    const range = normativeRanges[param];

    if (isNaN(value) || value < range.min || value > range.max) {
      setError(`Недопустимое значение для ${param}: должно быть между ${range.min} и ${range.max}`);
      return;
    }

    setManualAdjustments((prev) => ({
      ...prev,
      [param]: value,
    }));

    const predictData = {
      'Total charge rate, t/h': currentValues['Total charge rate, t/h'] || 100,
      'Overall blast volume, m3/h': param === 'Overall blast volume, m3/h' ? value : currentValues['Overall blast volume, m3/h'] || 1000,
      'Oxygen content in the blast (degree of oxygen enrichment in the blowing), %': currentValues['Oxygen content in the blast (degree of oxygen enrichment in the blowing), %'] || 21,
      'Temperature of exhaust gases in the off-gas duct, °C': currentValues['Temperature of exhaust gases in the off-gas duct, °C'] || 500,
      'Temperature of feed in the smelting zone, °C': currentValues['Temperature of feed in the smelting zone, °C'] || 1000,
      'feeder 2, speed': param === 'feeder 2, speed' ? value : currentValues['feeder 2, speed'] || 30,
    };

    try {
      const [predictResponse, recommendResponse] = await Promise.all([
        axios.post('http://localhost:5002/predict', predictData),
        axios.post('http://localhost:5002/recommend', predictData)
      ]);
      const cuPrediction = predictResponse.data.prediction;
      const { current_cu, recommendations: newRecommendations } = recommendResponse.data;

      setCuPredictions((prev) => [...prev, { time: new Date().toLocaleTimeString(), cu: cuPrediction }].slice(-100));
      setCurrentValues((prev) => ({ ...prev, [param]: value, cu: cuPrediction }));

      setRecommendations(newRecommendations);
      setLastRecommendationTime(Date.now());
      setError(null);
    } catch (error) {
      console.error('Error fetching prediction:', error.response?.data || error.message);
      setError(`Ошибка предсказания: ${error.response?.data?.error || error.message}`);
    }
  };

  return (
    <div className="container">
      <h1>Панель управления металлургией в реальном времени</h1>
      {error && <div className="error">{error}</div>}

      <div className="charts-grid">
        <div className="chart-container">
          <h2>Общий объем дутья (м³/ч)</h2>
          <LineChart width={400} height={250} data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="overallBlastVolume" stroke="#8884d8" name="Общий объем дутья (м³/ч)" />
          </LineChart>
        </div>
        <div className="chart-container">
          <h2>Температура пода, штейновый сифон (°C)</h2>
          <LineChart width={400} height={250} data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="tempFeedMatteSiphon" stroke="#82ca9d" name="Температура пода, штейновый сифон (°C)" />
          </LineChart>
        </div>
        <div className="chart-container">
          <h2>Температура пода, зона плавления, точка 1 (°C)</h2>
          <LineChart width={400} height={250} data={data}>
            < CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="tempFeedMeltingZonePoint1" stroke="#ffc658" name="Температура пода, зона плавления, точка 1 (°C)" />
          </LineChart>
        </div>
        <div className="chart-container">
          <h2>Расход природного газа (м3/ч)</h2>
          <LineChart width={400} height={250} data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="naturalGasFlow" stroke="#ff7300" name="Расход природного газа (м³/ч)" />
          </LineChart>
        </div>
        <div className="chart-container">
          <h2>Скорость питателей (км/ч)</h2>
          <LineChart width={400} height={250} data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="feeder2Speed" stroke="#ff00ff" name="Скорость питателей, км/ч" />
          </LineChart>
        </div>
        <div className="chart-container">
          <h2>Предсказанное [Cu] (%)</h2>
          <LineChart width={400} height={250} data={cuPredictions}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" />
            <YAxis domain={[50, 67]} />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="cu" stroke="#ff7300" name="Содержание Cu (%)" />
          </LineChart>
        </div>
      </div>

      <div className="current-values">
        <h2>Текущие значения</h2>
        {currentValues.cu && (
          <>
            <p>Общий объем дутья: {currentValues.overallBlastVolume?.toFixed(2)} м³/ч</p>
            <p>Температура пода, штейновый сифон: {currentValues.tempFeedMatteSiphon?.toFixed(2)} °C</p>
            <p>Температура пода, зона плавления, точка 1: {currentValues.tempFeedMeltingZonePoint1?.toFixed(2)} °C</p>
            <p>Расход природного газа: {currentValues.naturalGasFlow?.toFixed(2)}</p>
            <p>Скорость питателя 2: {currentValues.feeder2Speed?.toFixed(2)}</p>
            <p className="font-bold">Cu, %: {currentValues.cu?.toFixed(2)} %</p>
          </>
        )}
      </div>

      {recommendations.length > 0 && (
        <div className="recommendations">
          <h2>Рекомендации оператору</h2>
          {recommendations.map((rec, index) => (
            <p key={index} className="recommendation-text">
              {rec.parameter}: {rec.action} с {rec.current_value.toFixed(2)} до {rec.recommended_value.toFixed(2)} (изменение: {rec.change.toFixed(2)})
            </p>
          ))}
        </div>
      )}

      <div className="adjustments">
        <h2>Ручная корректировка параметров</h2>
        <div className="adjustment-item">
          <p>Общий объем дутья (м³/ч): {currentValues.overallBlastVolume?.toFixed(2)}</p>
          <input
            type="number"
            value={inputValues['Overall blast volume, m3/h']}
            onChange={(e) => handleInputChange('Overall blast volume, m3/h', e.target.value)}
            placeholder="Введите значение (15000–35000)"
            className="input-field"
          />
          <button
            className="btn btn-apply"
            onClick={() => applyAdjustment('Overall blast volume, m3/h')}
          >
            Применить
          </button>
        </div>
        <div className="adjustment-item">
          <p>Скорость питателей (км/ч): {currentValues.feeder2Speed?.toFixed(2)}</p>
          <input
            type="number"
            value={inputValues['feeder 2, speed']}
            onChange={(e) => handleInputChange('feeder 2, speed', e.target.value)}
            placeholder="Введите значение (15–45)"
            className="input-field"
          />
          <button
            className="btn btn-apply"
            onClick={() => applyAdjustment('feeder 2, speed')}
          >
            Применить
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;