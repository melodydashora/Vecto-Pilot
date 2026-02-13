
import fetch from 'node-fetch';

async function testOCR() {
  console.log("TEST: Sending Ride Offer OCR to /api/hooks/analyze-offer...");
  
  const payload = {
    text: "$12.50 • 4.2 mi • 8 min pickup",
    device_id: "test-device-001",
    source: "integration_test"
  };

  try {
    const response = await fetch('http://localhost:5000/api/hooks/analyze-offer', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' 
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP Error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    console.log("\n✅ API Response:", JSON.stringify(data, null, 2));
    
    if (data.analysis?.decision) {
        console.log(`\n🎉 SUCCESS: AI decided to ${data.analysis.decision} because: "${data.analysis.decision_reasoning}"`);
    } else {
        console.warn("\n⚠️ WARNING: AI response structure might be invalid.");
    }

  } catch (err) {
    console.error("\n❌ TEST FAILED:", err.message);
    if (err.code === 'ECONNREFUSED') {
        console.log("Ensure the server is running on port 5000!");
    }
  }
}

testOCR();
