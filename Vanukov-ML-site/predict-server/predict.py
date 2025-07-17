from flask import Flask, request, jsonify
from joblib import load
import pandas as pd
import numpy as np
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# Test mode flag
TEST_MODE = True

# Load model and validate
try:
    model = load('LIN_model.joblib')
    expected_features = model.feature_names_in_.tolist() if hasattr(model, 'feature_names_in_') else []
    print(f"Model loaded successfully. Expected features: {expected_features}")
except Exception as e:
    print(f"Error loading model: {str(e)}")
    model = None
    expected_features = []

# Define required features
required_features = expected_features or [
    'Total charge rate, t/h',
    'Overall blast volume, m3/h',
    'Oxygen content in the blast (degree of oxygen enrichment in the blowing), %',
    'Temperature of exhaust gases in the off-gas duct, °C',
    'Temperature of feed in the smelting zone, °C',
    'feeder 2, speed'
]

# Normative ranges for adjustable parameters
normative_ranges = {
    'Overall blast volume, m3/h': (15000, 35000),
    'feeder 2, speed': (15, 45),
}

model_coefficients = {
    'Overall blast volume, m3/h': 0.002,  # Adjusted for realistic effect
    'feeder 2, speed': 0.1,              # Adjusted for realistic effect
}

adjustment_count = 0

def simulate_prediction(adjustment_count):
    
    noise = np.random.normal(0, 0.5)
    if adjustment_count == 0:
        return max(50.0, min(60.0, 55.0 + noise))  # Below target, constrained to 50-60%
    elif adjustment_count == 1:
        return max(55.0, min(61.0, 58.0 + noise))  # After first adjustment, constrained to 55-61%
    else:
        return max(60.0, min(65.0, 62.5 + noise))  # After second adjustment, constrained to 60-65%

@app.route("/predict", methods=["POST"])
def predict():
    try:
        if TEST_MODE:
            return jsonify({"prediction": float(simulate_prediction(adjustment_count))})
        if not model:
            return jsonify({"error": "Model not loaded properly"}), 500

        data = request.get_json()
        if not data:
            return jsonify({"error": "No data provided"}), 400

        # Create DataFrame and validate features
        df = pd.DataFrame([data])
        missing_features = [f for f in required_features if f not in df.columns]
        if missing_features:
            return jsonify({"error": f"Missing features: {missing_features}"}), 400

        # Ensure numeric data
        for feature in required_features:
            df[feature] = pd.to_numeric(df[feature], errors='coerce')
            if df[feature].isna().any():
                return jsonify({"error": f"Non-numeric or invalid value for feature: {feature}"}), 400

        # Filter DataFrame to match model's expected features
        df = df[expected_features]  # Select only expected features in correct order
        prediction = model.predict(df)[0]
        # Get prediction
        return jsonify({"prediction": float(prediction)})

    except Exception as e:
        print(f"Error in /predict: {str(e)}")
        return jsonify({"error": f"Prediction failed: {str(e)}"}), 500

@app.route("/recommend", methods=["POST"])
def recommend():
    global adjustment_count
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "No data provided"}), 400

        # Create DataFrame and validate features
        df = pd.DataFrame([data])
        if TEST_MODE:
            current_cu = simulate_prediction(adjustment_count % 3)
            target_cu = 62.5  # Target midpoint
            deviation = target_cu - current_cu
            # Generate recommendations
            recommendations = []
            for param in ['Overall blast volume, m3/h', 'feeder 2, speed']:
                coef = model_coefficients.get(param, 0)
                if abs(deviation) > 0.5 and coef != 0:
                    # Force "Увеличить" for blast volume (positive coef) and "Уменьшить" for feeder speed (negative coef)
                    direction = 'Увеличить' if param == 'Overall blast volume, m3/h' and coef > 0 and deviation > 0 else \
                            'Уменьшить' if param == 'feeder 2, speed' and coef < 0 and deviation > 0 else None
                    if direction:
                        current_val = float(df[param].iloc[0])
                        norm_min, norm_max = normative_ranges.get(param, (None, None))
                        # Calculate change to move toward normative range
                        if param == 'Overall blast volume, m3/h':
                            target_val = 27000  # Aim for middle of normative range
                            change = max((current_val - target_val) * 0.1, abs(deviation) * 50)  
                            recommended_val = max(norm_min, min(current_val - change, norm_max)) if direction == 'Уменьшить' else \
                                            min(norm_max, max(current_val + change, norm_min))
                        else:  # feeder 2, speed
                            change = abs(deviation) * 2  # Smaller change for feeder speed
                            recommended_val = max(norm_min, min(current_val - change, norm_max)) if direction == 'Уменьшить' else \
                                            min(norm_max, max(current_val + change, norm_min))

                        recommendations.append({
                            "parameter": param,
                            "action": direction,
                            "current_value": current_val,
                            "recommended_value": recommended_val,
                            "change": abs(recommended_val - current_val),
                            "importance": abs(coef),
                            "safety_limit": f"{norm_min}-{norm_max}" if norm_min and norm_max else "N/A"
                        })
            recommendations = sorted(recommendations, key=lambda x: x["importance"], reverse=True)
            adjustment_count = min(adjustment_count + 1, 2)
            return jsonify({
            "current_cu": float(current_cu),
            "recommendations": recommendations
            })
        if not model:
            return jsonify({"error": "Model not loaded properly"}), 500

       
        missing_features = [f for f in required_features if f not in df.columns]
        if missing_features:
            return jsonify({"error": f"Missing features: {missing_features}"}), 400

        # Ensure numeric data
        for feature in required_features:
            df[feature] = pd.to_numeric(df[feature], errors='coerce')
            if df[feature].isna().any():
                return jsonify({"error": f"Non-numeric or invalid value for feature: {feature}"}), 400

        # Filter DataFrame to match model's expected features
        df = df[expected_features]

        # Get current Cu, %
        current_cu = simulate_prediction(df, adjustment_count)
        target_cu = 62.5  # Target midpoint
        deviation = target_cu - current_cu

        # Generate recommendations
        recommendations = []
        for param in ['Overall blast volume, m3/h', 'feeder 2, speed']:
            coef = model_coefficients.get(param, 0)
            if abs(deviation) > 0.5 and coef != 0:
                direction = 'Увеличить' if coef * deviation > 0 else 'Уменьшить'
                current_val = float(df[param].iloc[0])
                change = abs(deviation) * 10  # Larger change for realistic simulation
                norm_min, norm_max = normative_ranges.get(param, (None, None))
                
                if direction == 'Увеличить':
                    recommended_val = min(current_val + change, norm_max) if norm_max else current_val + change
                else:
                    recommended_val = max(current_val - change, norm_min) if norm_min else current_val - change

                recommendations.append({
                    "parameter": param,
                    "action": direction,
                    "current_value": current_val,
                    "recommended_value": recommended_val,
                    "change": abs(recommended_val - current_val),
                    "importance": abs(coef),
                    "safety_limit": f"{norm_min}-{norm_max}" if norm_min and norm_max else "N/A"
                })

        recommendations = sorted(recommendations, key=lambda x: x["importance"], reverse=True)

        
        return jsonify({
            "current_cu": float(current_cu),
            "recommendations": recommendations
        })

    except Exception as e:
        print(f"Error in /recommend: {str(e)}")
        return jsonify({"error": f"Recommendation failed: {str(e)}"}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5002, debug=True)