#!/usr/bin/env python3
import argparse, re
import pandas as pd
import numpy as np
from difflib import get_close_matches

LEAVE_STATUSES = [
    "Maternity/Paternity", "Sick", "Holiday",
    "Compassionate Leave", "Other Unavailable", "Pre-Agreed Appointment"
]
PRIORITY = {"Maternity/Paternity":1,"Sick":2,"Holiday":3,
            "Compassionate Leave":4,"Other Unavailable":5,
            "Pre-Agreed Appointment":6,"Available":7}

def normalize_name(name: str) -> str:
    """Order-insensitive normalizer: remove tags/titles/punct, lowercase, token-sort."""
    if pd.isna(name): 
        return ""
    s = str(name).lower()
    s = re.sub(r"\(.*?\)", "", s)               # remove (GH), (NL), etc.
    s = re.sub(r"[^a-z\s]", " ", s)             # remove punctuation
    s = re.sub(r"\b(mr|mrs|miss|ms|dr)\b", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    parts = s.split()
    parts.sort()
    return " ".join(parts)

def tstr(x):
    try:
        return pd.to_datetime(x).strftime("%H:%M")
    except Exception:
        return ""

def hours_between(start, end):
    try:
        st = pd.to_datetime(start); en = pd.to_datetime(end)
        if pd.isna(st) or pd.isna(en): return np.nan
        d = (en - st).total_seconds()/3600.0
        if d < 0: d += 24.0
        return round(d, 2)
    except Exception:
        return np.nan

def load_inputs(av_path, gh_path):
    avail = pd.read_excel(av_path, sheet_name="CAREGiver Availability")
    gh    = pd.read_excel(gh_path,    sheet_name="Data")
    # Minimal subset from GH
    gh = gh[['Actual Employee Name','Actual Employee Hours Per Week']].dropna(how='all')
    gh = gh.rename(columns={
        'Actual Employee Name':'Employee Name',
        'Actual Employee Hours Per Week':'Contracted Weekly Hours'
    }).dropna(subset=['Employee Name','Contracted Weekly Hours'])
    return avail, gh

def prepare(avail, gh):
    gh = gh.copy()
    gh['gh_key'] = gh['Employee Name'].apply(normalize_name)

    avail = avail.rename(columns={
        'CAREGiver Name':'Employee Name',
        'Start Date':'Date',
        'Type':'Status',
        'Notes':'Notes'
    }).copy()
    avail['Date'] = pd.to_datetime(avail['Date'], dayfirst=True, errors="coerce").dt.date
    avail['Time Windows'] = avail['Start Time'].apply(tstr) + "-" + avail['End Time'].apply(tstr)
    avail['name_key'] = avail['Employee Name'].apply(normalize_name)

    # Fuzzy map availability names to GH keys
    gh_keys = gh['gh_key'].unique().tolist()
    def map_to_gh(k):
        if not k: return None
        match = get_close_matches(k, gh_keys, n=1, cutoff=0.7)
        return match[0] if match else None

    avail['gh_key'] = avail['name_key'].apply(map_to_gh)
    avail = avail[avail['gh_key'].notna()].copy()

    merged = avail.merge(gh[['gh_key','Employee Name','Contracted Weekly Hours']],
                         on='gh_key', how='inner', suffixes=('','_gh'))
    # Canonical GH name
    merged['Employee Name'] = merged['Employee Name_gh'].fillna(merged['Employee Name'])
    merged.drop(columns=['Employee Name_gh'], inplace=True)

    # Compute unique days per employee (from availability)
    days_av = merged.groupby('gh_key')['Date'].nunique().rename('Days Available')
    merged = merged.merge(days_av, on='gh_key', how='left')
    merged['Contracted Daily Hours'] = (
        merged['Contracted Weekly Hours'] / merged['Days Available']
    ).round(2)

    # Safer hours: prefer 'Hours' if present, else compute from time
    merged['Hours_calc'] = merged.apply(lambda r: hours_between(r['Start Time'], r['End Time']), axis=1)
    merged['Hours_effective'] = np.where(merged['Hours'].notna(), merged['Hours'], merged['Hours_calc'])
    return merged

def collapse_one_group(g):
    emp_name = g['Employee Name'].iloc[0]
    weekly   = float(g['Contracted Weekly Hours'].iloc[0])
    daily    = float(g['Contracted Daily Hours'].iloc[0]) if pd.notna(g['Contracted Daily Hours'].iloc[0]) else 0.0
    date     = g['Date'].iloc[0]

    # Deduplicate identical windows per status
    dd = g.copy()
    dd['Start_str'] = dd['Start Time'].apply(tstr)
    dd['End_str']   = dd['End Time'].apply(tstr)
    dd = dd.drop_duplicates(subset=['Status','Start_str','End_str'])

    # Aggregate per status
    agg = dd.groupby('Status', dropna=False).agg(
        Hours_raw=('Hours_effective','sum'),
        Windows=('Time Windows', lambda s: "; ".join(sorted(set([w for w in s if isinstance(w,str) and w not in ("","-")])))),
        Notes=('Notes', lambda s: "; ".join(sorted(set([n for n in s.dropna().astype(str) if n != ""]))))
    ).reset_index()

    # Total leave raw + cap at daily
    total_leave_raw = agg[agg['Status'].isin(LEAVE_STATUSES)]['Hours_raw'].sum()
    total_leave_capped = min(total_leave_raw, daily)

    rows = []
    for _, r in agg.iterrows():
        st, tw, nts = r['Status'], r['Windows'], r['Notes']
        if st == "Available":
            hours = max(daily - total_leave_capped, 0.0)  # adjusted available
            net   = hours
        elif st in LEAVE_STATUSES:
            hours = min(float(r['Hours_raw'] if pd.notna(r['Hours_raw']) else 0.0), daily)
            net   = 0.0
        else:
            hours = float(r['Hours_raw'] if pd.notna(r['Hours_raw']) else 0.0)
            net   = 0.0
        rows.append({
            "Employee Name": emp_name,
            "Contracted Weekly Hours": round(weekly,2),
            "Contracted Daily Hours": round(daily,2),
            "Date": date,
            "Status": st,
            "Time Windows": tw,
            "Hours": round(hours,2),
            "Net Capacity": round(net,2),
            "Notes": nts
        })
    out = pd.DataFrame(rows)
    out["Priority"] = out["Status"].map(PRIORITY).fillna(999)
    return out.sort_values(["Priority"])

def run_cleaner(av_path, gh_path, out_path=None):
    avail, gh = load_inputs(av_path, gh_path)
    merged = prepare(avail, gh)
    cleaned = merged.groupby(['gh_key','Date'], group_keys=False).apply(collapse_one_group).reset_index(drop=True)
    cleaned = cleaned[[
        "Employee Name","Contracted Weekly Hours","Contracted Daily Hours",
        "Date","Status","Time Windows","Hours","Net Capacity","Notes"
    ]]
    if not out_path:
        import pathlib
        out_path = str(pathlib.Path(av_path).with_name("cleaned_capacity.xlsx"))
    cleaned.to_excel(out_path, index=False)
    print(f"Saved: {out_path}  ({len(cleaned)} rows)")

if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Clean and merge capacity data")
    p.add_argument("--availability", "-a", required=True, help="Path to 'Availability Export.xlsx'")
    p.add_argument("--guaranteed", "-g", required=True, help="Path to 'Care Pro Guaranteed Hours.xlsx' (Data sheet)")
    p.add_argument("--out", "-o", default="", help="Output xlsx path (optional)")
    args = p.parse_args()
    run_cleaner(args.availability, args.guaranteed, args.out.strip() or None)
