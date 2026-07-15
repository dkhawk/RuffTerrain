import os
import sys
import json
import unittest

# Append workspace root to path to import runner_agent
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

import runner_agent

class TestAgentTools(unittest.TestCase):
    def setUp(self):
        self.samples_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '../samples'))
        self.gpx_path = os.path.join(self.samples_dir, 'LeadvilleMarathon.gpx')
        
    def test_segment_route(self):
        print("\nTesting segment_route...")
        res_str = runner_agent.segment_route(self.gpx_path)
        res = json.loads(res_str)
        
        self.assertNotIn("error", res)
        self.assertIn("sectors", res)
        self.assertIn("waypoints", res)
        self.assertIn("total_distance_m", res)
        self.assertGreater(res["total_distance_m"], 0)
        self.assertGreater(len(res["sectors"]), 0)
        
        print(f"✔ Segmented course: {res['name']}")
        print(f"✔ Detected {len(res['sectors'])} terrain sectors.")
        
    def test_calibrate_athlete(self):
        print("\nTesting calibrate_athlete...")
        res_str = runner_agent.calibrate_athlete([self.gpx_path], ["training_run"])
        res = json.loads(res_str)
        
        self.assertNotIn("error", res)
        self.assertIn("basePaces", res)
        self.assertIn("restDurationMin", res)
        self.assertIn("enduranceMetrics", res)
        self.assertIn("fatigueDecayLambda", res["enduranceMetrics"])
        
        print(f"✔ Calibrated paces: {res['basePaces']}")
        print(f"✔ Fatigue Decay Lambda: {res['enduranceMetrics']['fatigueDecayLambda']}")
        
    def test_generate_execution_plan(self):
        print("\nTesting generate_execution_plan...")
        
        # First get calibrated profile
        profile_str = runner_agent.calibrate_athlete([self.gpx_path], ["training_run"])
        
        plan_str = runner_agent.generate_execution_plan(
            self.gpx_path, 
            profile_str, 
            "hard_race", 
            start_time="06:00", 
            goal_finish_time="6.5"
        )
        plan = json.loads(plan_str)
        
        self.assertNotIn("error", plan)
        self.assertEqual(plan["status"], "success")
        self.assertIn("json_plan_path", plan)
        self.assertIn("markdown_guide_path", plan)
        self.assertIn("summary_finish_steady_hrs", plan)
        
        # Verify saved files
        self.assertTrue(os.path.exists(plan["json_plan_path"]))
        self.assertTrue(os.path.exists(plan["markdown_guide_path"]))
        
        print(f"✔ Pacing plan simulated successfully.")
        print(f"✔ Predicted Steady Finish: {plan['summary_finish_steady_hrs']} hours.")

if __name__ == '__main__':
    unittest.main()
