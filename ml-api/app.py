from flask import Flask, jsonify, request

from did import resolve_did
from features import extract_features
from model import score_address

app = Flask(__name__)


@app.get("/health")
def health():
    return jsonify({"status": "ok"})


@app.post("/score")
def score():
    payload = request.get_json(force=True)
    address = payload.get("address", "")
    features = extract_features(address)
    result = score_address(features)
    return jsonify({"address": address, "did": resolve_did(address), **result})


@app.post("/batch")
def batch():
    payload = request.get_json(force=True)
    addresses = payload.get("addresses", [])
    return jsonify([{"address": address, **score_address(extract_features(address))} for address in addresses])


@app.post("/default-probability")
def default_probability():
    payload = request.get_json(force=True)
    address = payload.get("address", "")
    result = score_address(extract_features(address))
    return jsonify({"address": address, "default_probability": result["default_probability"]})


if __name__ == "__main__":
    app.run(debug=True)
