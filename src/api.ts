// src/api.ts
import { INITIAL_RECOVERY_STATE, MOCK_SIMULATION_RESULT, RecoveryState } from './mockData';

const BASE_URL = "https://your-api-gateway-id.execute-api.us-east-1.amazonaws.com/prod"; // AWS endpoint

export async function fetchDashboardData(): Promise<RecoveryState> {
  try {
    const response = await fetch(`${BASE_URL}/dashboard`, { timeout: 3000 } as any);
    if (!response.ok) throw new Error("AWS endpoint failed");
    return await response.json();
  } catch (error) {
    console.warn("⚠️ AWS API unavailable. Using fallback mock data.");
    return INITIAL_RECOVERY_STATE;
  }
}