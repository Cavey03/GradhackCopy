"""Seed a demo subset from Fully_sorted2.xlsx into DynamoDB.

- Personal Information + Health Data  -> recovery-members (health nested)
- Exercise Data                       -> recovery-timeseries as ACTIVITY# + READING# items

Idempotent: re-running overwrites the same items (safe for demo reset).
"""

from decimal import Decimal
import openpyxl
import boto3

XLSX_PATH = "Fully_sorted2.xlsx"
REGION = "eu-central-1"
MAX_MEMBERS = 60   # demo subset; raise later if needed

dynamodb = boto3.resource("dynamodb", region_name=REGION)
members_table = dynamodb.Table("recovery-members")
timeseries_table = dynamodb.Table("recovery-timeseries")


def clean(v):
    """Make a cell safe for DynamoDB."""
    if v is None:
        return None
    if hasattr(v, "strftime"):          # datetime -> ISO date string
        return v.strftime("%Y-%m-%d")
    if isinstance(v, float):            # DynamoDB needs Decimal, not float
        return Decimal(str(v))
    if isinstance(v, bool):
        return v
    if isinstance(v, int):
        return v
    return str(v)


def row_dict(header, row):
    return {h: row[i] for i, h in enumerate(header)}


def load_sheet(wb, name):
    ws = wb[name]
    rows = ws.iter_rows(values_only=True)
    header = list(next(rows))
    return header, list(rows)


def main():
    wb = openpyxl.load_workbook(XLSX_PATH, data_only=True, read_only=True)

    pi_h, pi_rows = load_sheet(wb, "Personal Information")
    hd_h, hd_rows = load_sheet(wb, "Health Data")
    ex_h, ex_rows = load_sheet(wb, "Exercise Data")

    # Index health by entity number (one record per member)
    health_by_ent = {}
    for r in hd_rows:
        d = row_dict(hd_h, r)
        health_by_ent[d["Entity Number"]] = d

    # Pick the first MAX_MEMBERS members
    # Count exercise rows per member, then pick members with the MOST history
    from collections import Counter
    ex_counts = Counter(row_dict(ex_h, r)["Entity Number"] for r in ex_rows)

    pi_by_ent = {}
    for r in pi_rows:
        d = row_dict(pi_h, r)
        if d["Entity Number"]:
            pi_by_ent[d["Entity Number"]] = d

    ranked = [ent for ent, _ in ex_counts.most_common() if ent in pi_by_ent]
    chosen_ids = set(ranked[:MAX_MEMBERS])
    chosen = [pi_by_ent[ent] for ent in ranked[:MAX_MEMBERS]]

    top_counts = [ex_counts[ent] for ent in ranked[:MAX_MEMBERS]]
    if top_counts:
        print(f"Chosen {len(chosen)} members; workouts each: "
              f"max {top_counts[0]}, min {top_counts[-1]}")
  

    # ---- Write members (personal + nested health) ----
    with members_table.batch_writer() as batch:
        for d in chosen:
            ent = d["Entity Number"]
            h = health_by_ent.get(ent, {})
            item = {
                "memberId": clean(ent),
                "firstName": clean(d["First Name"]),
                "surname": clean(d["Surname"]),
                "gender": clean(d["Gender"]),
                "dob": clean(d["DOB"]),
                "age": clean(d["Age"]),
                "province": clean(d["Province"]),
                "city": clean(d["City"]),
                "medicalAidPlan": clean(d["Medical Aid Plan"]),
                "vitalityStatus": clean(d["Vitality Status"]),
                "joinDate": clean(d["Join Date"]),
                "activityBaseline": clean(d["Activity Baseline"]),
                "recoveryGoal": clean(d["Recovery Goal"]),
                "recoveryContext": {
                    "eventDate": clean(h.get("Event Date")),
                    "recoveryContext": clean(h.get("Recovery Context")),
                    "eventType": clean(h.get("Event Type")),
                    "conditionCategory": clean(h.get("Condition Category")),
                    "diagnosisOrEvent": clean(h.get("Diagnosis or Event")),
                    "severity": clean(h.get("Severity")),
                    "recoveryStage": clean(h.get("Recovery Stage")),
                    "mobilityLimitation": clean(h.get("Mobility Limitation")),
                    "painScore": clean(h.get("Pain Score")),
                    "clinicianCleared": clean(h.get("Clinician Cleared")),
                    "contraindicationFlag": clean(h.get("Contraindication Flag")),
                    "vo2RiskBand": clean(h.get("VO2 Risk Band")),
                    "medicationImpact": clean(h.get("Medication Impact")),
                },
                "source": "seed",
            }
            # DynamoDB rejects empty strings inside maps in some SDKs; drop Nones
            item["recoveryContext"] = {k: v for k, v in item["recoveryContext"].items() if v is not None}
            batch.put_item(Item={k: v for k, v in item.items() if v is not None})

    print(f"Seeded {len(chosen)} members.")

    # ---- Write exercise rows for chosen members (ACTIVITY# + READING#) ----
    ex_count = 0
    with timeseries_table.batch_writer() as batch:
        for r in ex_rows:
            d = row_dict(ex_h, r)
            ent = d["Entity Number"]
            if ent not in chosen_ids:
                continue
            date = clean(d["Record Date"])       # "YYYY-MM-DD"

            activity = {
                "memberId": clean(ent),
                "sk": f"ACTIVITY#{date}",
                "type": "ACTIVITY",
                "recordDate": date,
                "workoutType": clean(d["Workout Type"]),
                "workoutStatus": clean(d["Workout Status"]),
                "durationMin": clean(d["Duration Min"]),
                "distanceKm": clean(d["Distance Km"]),
                "avgHeartRate": clean(d["Avg Heart Rate"]),
                "maxHeartRate": clean(d["Max Heart Rate"]),
                "caloriesBurned": clean(d["Calories Burned"]),
                "rpe": clean(d["RPE 1-10"]),
            }
            reading = {
                "memberId": clean(ent),
                "sk": f"READING#{date}",
                "type": "READING",
                "recordDate": date,
                "restingHeartRate": clean(d["Resting Heart Rate"]),
                "hrvMs": clean(d["HRV ms"]),
                "sleepHours": clean(d["Sleep Hours"]),
                "sleepQualityScore": clean(d["Sleep Quality Score"]),
                "vo2MaxEstimate": clean(d["VO2 Max Estimate"]),
            }
            batch.put_item(Item={k: v for k, v in activity.items() if v is not None})
            batch.put_item(Item={k: v for k, v in reading.items() if v is not None})
            ex_count += 2

    print(f"Seeded {ex_count} timeseries items ({ex_count//2} workouts split into ACTIVITY+READING).")


if __name__ == "__main__":
    main()