"""
POLYMATH INFRASHIELD — Bengaluru Investor Demo
================================================
Full-bleed dark/satellite map with collapsible layer panel and InfraShield
facility risk overlays. UX pattern inspired by OpenGridWorks (dark basemap,
floating chip panel, satellite underlay toggle) — recreated independently.

Run:    streamlit run streamlit_app.py
Share:  push to GitHub → connect at share.streamlit.io
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import folium
import pandas as pd
import streamlit as st
from streamlit_folium import st_folium

# ─────────────────────────────────────────────────────────────────────────────
# Page config — full bleed, dark
# ─────────────────────────────────────────────────────────────────────────────
st.set_page_config(
    page_title="POLYMATH INFRASHIELD · Bengaluru",
    page_icon="⚡",
    layout="wide",
    initial_sidebar_state="collapsed",
)

# ─────────────────────────────────────────────────────────────────────────────
# CSS — strip Streamlit chrome, build floating panels
# ─────────────────────────────────────────────────────────────────────────────
st.markdown("""
<style>
/* Hide Streamlit branding + top bar */
#MainMenu, footer, header {visibility: hidden;}
[data-testid="stToolbar"] {display: none;}
[data-testid="stDecoration"] {display: none;}

/* Make app fill viewport with no padding */
html, body, [data-testid="stAppViewContainer"], [data-testid="stMain"] {
    background: #0a0e17 !important;
    color: #e6edf6 !important;
}
.main .block-container {
    padding: 0 !important;
    max-width: 100% !important;
    margin: 0 !important;
}
section.main > div {padding: 0 !important;}

/* Folium iframe = full viewport */
iframe {
    height: 100vh !important;
    width: 100vw !important;
    border: 0 !important;
    display: block;
}

/* Collapsed sidebar control button — keep visible */
[data-testid="collapsedControl"] {
    background: rgba(20,28,42,0.92) !important;
    border: 1px solid #1f2c44 !important;
    border-radius: 6px;
    padding: 4px;
}

/* Sidebar styling when expanded */
[data-testid="stSidebar"] {
    background: rgba(13,18,28,0.97) !important;
    border-right: 1px solid #1a2436;
    backdrop-filter: blur(8px);
}
[data-testid="stSidebar"] * {color: #cfd9ea !important;}
[data-testid="stSidebar"] h1, [data-testid="stSidebar"] h2, [data-testid="stSidebar"] h3 {
    color: #e9f0fb !important;
    font-weight: 600 !important;
    letter-spacing: 0.02em;
}
[data-testid="stSidebar"] hr {border-color: #1f2c44 !important;}

/* Brand badge top-left, floating over map */
.brand-badge {
    position: fixed;
    top: 12px;
    left: 60px;
    z-index: 9999;
    background: rgba(13,18,28,0.92);
    border: 1px solid #1f2c44;
    padding: 8px 14px;
    border-radius: 8px;
    backdrop-filter: blur(10px);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    box-shadow: 0 4px 14px rgba(0,0,0,0.35);
}
.brand-badge .brand-name {
    color: #e9f0fb;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.06em;
}
.brand-badge .brand-sub {
    color: #7d92b3;
    font-size: 10px;
    margin-top: 1px;
    letter-spacing: 0.05em;
}

/* Streamlit widget overrides for chip-like look */
.stCheckbox, .stRadio, .stSelectbox {margin-bottom: 0.4rem !important;}
.stCheckbox > label > div:first-child {background: #18223a !important; border-color: #2a3954 !important;}
.stRadio > div {background: transparent !important;}

/* Layer-section heading style inside sidebar */
.section-title {
    color: #6f86ab !important;
    font-size: 10px !important;
    font-weight: 700 !important;
    letter-spacing: 0.14em !important;
    text-transform: uppercase !important;
    margin: 12px 0 6px 0 !important;
}

/* Hide spinner clutter */
.stSpinner > div {border-color: #3b82f6 transparent transparent transparent !important;}
</style>
""", unsafe_allow_html=True)

# ─────────────────────────────────────────────────────────────────────────────
# Data layer — read from infrashield.db, fall back to inline demo data
# ─────────────────────────────────────────────────────────────────────────────
DB_PATH = Path(__file__).parent / "backend" / "infrashield.db"

RISK_LEVELS = ["Critical", "High", "Medium", "Low", "Insufficient Data"]
RISK_COLORS = {
    "Critical": "#ef4444",
    "High": "#f97316",
    "Medium": "#f59e0b",
    "Low": "#22c55e",
    "Insufficient Data": "#9ca3af",
}

@st.cache_data(ttl=300)
def load_facilities() -> pd.DataFrame:
    if not DB_PATH.exists():
        return _demo_facilities()
    try:
        with sqlite3.connect(str(DB_PATH)) as cx:
            df = pd.read_sql("SELECT * FROM facilities", cx)
        if df.empty:
            return _demo_facilities()
        return df
    except Exception:
        return _demo_facilities()

@st.cache_data(ttl=300)
def load_power_assets() -> pd.DataFrame:
    if not DB_PATH.exists():
        return pd.DataFrame()
    try:
        with sqlite3.connect(str(DB_PATH)) as cx:
            return pd.read_sql("SELECT * FROM power_assets", cx)
    except Exception:
        return pd.DataFrame()

def _demo_facilities() -> pd.DataFrame:
    rows = [
        ("f1", "Victoria Hospital", "hospital", "Bangalore Central", 12.9591, 77.5747, 78, "Critical"),
        ("f2", "Bowring & Lady Curzon", "hospital", "Shivajinagar", 12.9837, 77.6056, 71, "High"),
        ("f3", "NIMHANS", "hospital", "Hosur Road", 12.9430, 77.5946, 64, "High"),
        ("f4", "ITPL Tech Park", "tech_park", "Whitefield", 12.9858, 77.7368, 72, "High"),
        ("f5", "Manyata Tech Park", "tech_park", "Hebbal", 13.0468, 77.6210, 68, "High"),
        ("f6", "KIA Airport", "airport", "Devanahalli", 13.1986, 77.7066, 52, "Medium"),
        ("f7", "TG Halli WTP", "water_pumping_station", "Bangalore West", 12.9380, 77.4350, 81, "Critical"),
        ("f8", "Cubbon Park PS", "police_station", "Central", 12.9762, 77.5929, 38, "Low"),
        ("f9", "MG Road Metro", "metro_station", "Central", 12.9760, 77.6068, 44, "Medium"),
        ("f10", "Electronic City Phase 1", "industrial_estate", "South", 12.8456, 77.6603, 67, "High"),
        ("f11", "Whitefield Substation", "power_substation", "Whitefield", 12.9650, 77.7510, 74, "High"),
        ("f12", "BMTC Shantinagar Depot", "bus_depot", "Shantinagar", 12.9518, 77.5965, 41, "Medium"),
    ]
    return pd.DataFrame(rows, columns=[
        "id","name","facility_type","zone","latitude","longitude",
        "continuity_risk_score","risk_level"
    ])

# ─────────────────────────────────────────────────────────────────────────────
# Scenario engine — applies score deltas in-memory
# ─────────────────────────────────────────────────────────────────────────────
SCENARIOS = {
    "— Baseline —": {},
    "Monsoon Cloudburst (Aug 2026)": {
        "hospital": +12, "water_pumping_station": +18, "metro_station": +9,
        "industrial_estate": +7, "tech_park": +5,
    },
    "Grid Failure: Whitefield Feeder": {
        "tech_park": +22, "industrial_estate": +14, "hospital": +9,
        "power_substation": +25,
    },
    "Cauvery Water Curtailment": {
        "water_pumping_station": +28, "hospital": +14, "industrial_estate": +9,
    },
    "Heatwave + Power Surge (45°C peak)": {
        "hospital": +10, "tech_park": +14, "power_substation": +18,
        "water_pumping_station": +6,
    },
}

def reclassify(score: float) -> str:
    if score >= 76: return "Critical"
    if score >= 56: return "High"
    if score >= 31: return "Medium"
    if score >  0:  return "Low"
    return "Insufficient Data"

def apply_scenario(df: pd.DataFrame, scenario: str) -> pd.DataFrame:
    deltas = SCENARIOS.get(scenario, {})
    if not deltas: return df
    out = df.copy()
    out["delta"] = out["facility_type"].map(deltas).fillna(0).astype(int)
    out["continuity_risk_score"] = (out["continuity_risk_score"] + out["delta"]).clip(0, 100)
    out["risk_level"] = out["continuity_risk_score"].apply(reclassify)
    return out

# ─────────────────────────────────────────────────────────────────────────────
# Sidebar — layer panel (mirrors OpenGridWorks chip pattern)
# ─────────────────────────────────────────────────────────────────────────────
with st.sidebar:
    st.markdown("### POLYMATH **INFRASHIELD**")
    st.caption("Bengaluru · Live continuity risk")
    st.markdown("---")

    st.markdown('<div class="section-title">Basemap</div>', unsafe_allow_html=True)
    basemap = st.radio(
        "basemap", ["Dark", "Satellite"],
        horizontal=True, label_visibility="collapsed", key="basemap",
    )

    st.markdown('<div class="section-title">Facility Layers</div>', unsafe_allow_html=True)
    show_critical = st.checkbox("🔴  Critical", value=True)
    show_high     = st.checkbox("🟠  High", value=True)
    show_medium   = st.checkbox("🟡  Medium", value=True)
    show_low      = st.checkbox("🟢  Low", value=False)

    st.markdown('<div class="section-title">Infrastructure</div>', unsafe_allow_html=True)
    show_hospitals = st.checkbox("🏥  Hospitals", value=True)
    show_water     = st.checkbox("💧  Water / Sewage", value=True)
    show_power     = st.checkbox("⚡  Power Substations", value=True)
    show_tech      = st.checkbox("💼  Tech Parks", value=True)
    show_transit   = st.checkbox("🚇  Transit", value=True)
    show_emerg     = st.checkbox("🚒  Emergency", value=True)

    st.markdown('<div class="section-title">Overlay</div>', unsafe_allow_html=True)
    show_heatmap = st.checkbox("🔥  Risk heat halo", value=True)
    show_labels  = st.checkbox("🏷  Facility labels", value=False)

    st.markdown('<div class="section-title">Scenario Simulation</div>', unsafe_allow_html=True)
    scenario = st.selectbox(
        "scenario", list(SCENARIOS.keys()),
        label_visibility="collapsed", key="scenario",
    )
    if scenario != "— Baseline —":
        st.caption(f"⚡ Applying delta to {sum(1 for v in SCENARIOS[scenario].values() if v>0)} facility types")

    st.markdown("---")
    st.caption("© POLYBRAIN tm · 2026")

# ─────────────────────────────────────────────────────────────────────────────
# Brand badge (floating over map, top-left)
# ─────────────────────────────────────────────────────────────────────────────
st.markdown("""
<div class="brand-badge">
    <div class="brand-name">⚡ INFRASHIELD</div>
    <div class="brand-sub">BENGALURU · LIVE RISK GRID</div>
</div>
""", unsafe_allow_html=True)

# ─────────────────────────────────────────────────────────────────────────────
# Build map
# ─────────────────────────────────────────────────────────────────────────────
df = load_facilities()
df = apply_scenario(df, scenario)
power_df = load_power_assets()

# Filter by risk level
allowed_risk = set()
if show_critical: allowed_risk.add("Critical")
if show_high:     allowed_risk.add("High")
if show_medium:   allowed_risk.add("Medium")
if show_low:      allowed_risk.add("Low")
df = df[df["risk_level"].isin(allowed_risk)]

# Filter by infrastructure type
type_groups = {
    "hospital":             show_hospitals,
    "clinic":               show_hospitals,
    "water_pumping_station":show_water,
    "sewage_treatment_plant":show_water,
    "power_substation":     show_power,
    "tech_park":            show_tech,
    "industrial_estate":    show_tech,
    "metro_station":        show_transit,
    "bus_depot":            show_transit,
    "railway_station":      show_transit,
    "airport":              show_transit,
    "fire_station":         show_emerg,
    "police_station":       show_emerg,
    "emergency_command_centre": show_emerg,
    "public_building":      show_emerg,
}
df = df[df["facility_type"].apply(lambda t: type_groups.get(t, True))]

# Build folium map with selected basemap
BENGALURU = (12.9716, 77.5946)
m = folium.Map(
    location=BENGALURU,
    zoom_start=11,
    tiles=None,
    control_scale=True,
    zoom_control=True,
    prefer_canvas=True,
)

if basemap == "Satellite":
    # Esri World Imagery — free, no API key
    folium.TileLayer(
        tiles="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        attr="Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics",
        name="Satellite", overlay=False, control=False, max_zoom=19,
    ).add_to(m)
    # Add subtle dark labels overlay so cities/roads stay readable on satellite
    folium.TileLayer(
        tiles="https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png",
        attr="&copy; CARTO labels", subdomains="abcd",
        name="labels", overlay=True, control=False, max_zoom=20, opacity=0.85,
    ).add_to(m)
else:
    # Dark Matter — clean dark cartographic style
    folium.TileLayer(
        tiles="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        attr="&copy; CARTO &copy; OpenStreetMap contributors", subdomains="abcd",
        name="Dark", overlay=False, control=False, max_zoom=20,
    ).add_to(m)

# ── Heat halo (large translucent circles under markers) ──────────────────────
if show_heatmap:
    for _, r in df.iterrows():
        if r["risk_level"] in ("Critical", "High"):
            folium.Circle(
                location=[r["latitude"], r["longitude"]],
                radius=(r["continuity_risk_score"] * 18),  # metres
                color=RISK_COLORS[r["risk_level"]],
                weight=0,
                fill=True,
                fill_color=RISK_COLORS[r["risk_level"]],
                fill_opacity=0.10,
            ).add_to(m)

# ── Power assets (amber, OpenGridWorks-substation style) ─────────────────────
if show_power and not power_df.empty:
    for _, p in power_df.iterrows():
        folium.CircleMarker(
            location=[p["latitude"], p["longitude"]],
            radius=5,
            color="#f59e0b", weight=1.5,
            fill=True, fill_color="#fbbf24", fill_opacity=0.85,
            popup=folium.Popup(
                f"<b>⚡ {p.get('name','Substation')}</b><br>"
                f"<span style='color:#64748b'>{p.get('asset_type','')} · {p.get('zone','')}</span>",
                max_width=240,
            ),
        ).add_to(m)

# ── Facility markers ─────────────────────────────────────────────────────────
type_icons = {
    "hospital":"🏥","clinic":"🏥","water_pumping_station":"💧",
    "sewage_treatment_plant":"🔄","fire_station":"🚒","police_station":"🚔",
    "emergency_command_centre":"📡","tech_park":"💼","industrial_estate":"🏭",
    "public_building":"🏛️","metro_station":"🚇","bus_depot":"🚌",
    "railway_station":"🚂","airport":"✈️","power_substation":"⚡",
}
for _, r in df.iterrows():
    color = RISK_COLORS.get(r["risk_level"], "#9ca3af")
    is_critical = r["risk_level"] == "Critical"
    radius = 11 if is_critical else 8
    icon = type_icons.get(r["facility_type"], "📍")
    delta_html = ""
    if "delta" in r and r.get("delta", 0):
        d = int(r["delta"])
        delta_html = f"<div style='color:#fbbf24;font-size:10px;margin-top:3px'>⚡ Scenario delta: +{d}</div>"
    popup_html = (
        f"<div style='font-family:-apple-system,sans-serif;font-size:11px;max-width:240px;color:#0f172a'>"
        f"<div style='font-weight:700;font-size:13px;margin-bottom:2px'>{icon} {r['name']}</div>"
        f"<div style='color:#64748b;margin-bottom:5px'>{r['facility_type'].replace('_',' ').title()} · {r['zone']}</div>"
        f"<div style='display:flex;align-items:center;gap:6px'>"
        f"<span style='font-weight:700;font-size:14px'>{int(r['continuity_risk_score'])}</span>"
        f"<span style='background:{color};color:#fff;border-radius:4px;padding:2px 8px;font-size:10px;font-weight:700'>{r['risk_level']}</span>"
        f"</div>{delta_html}</div>"
    )
    marker = folium.CircleMarker(
        location=[r["latitude"], r["longitude"]],
        radius=radius,
        color="#ff6b6b" if is_critical else "#ffffff",
        weight=2.5 if is_critical else 1.2,
        fill=True, fill_color=color,
        fill_opacity=0.95 if is_critical else 0.85,
        popup=folium.Popup(popup_html, max_width=260),
    )
    if show_labels:
        marker.add_child(folium.Tooltip(
            f"<span style='color:#fff;background:rgba(10,15,25,0.85);padding:2px 6px;border-radius:3px;font-size:10px'>{r['name']}</span>",
            permanent=True, direction="right", offset=(8, 0),
        ))
    marker.add_to(m)

# ─────────────────────────────────────────────────────────────────────────────
# Render full-bleed map (no return value needed; pure visual)
# ─────────────────────────────────────────────────────────────────────────────
st_folium(
    m,
    use_container_width=True,
    height=900,
    returned_objects=[],   # don't trigger reruns on pan/zoom
    key=f"map-{basemap}-{scenario}",
)
