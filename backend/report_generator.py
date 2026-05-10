"""
Generates the executive HTML report using Jinja2.
Professional infrastructure-consulting style for ATBOSE / Polymath.
"""
from datetime import datetime
from jinja2 import Template

REPORT_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>InfraShield Bengaluru — Continuity Risk Report</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a2e; background: #f8f9fa; }
  .cover { background: #0f172a; color: white; padding: 60px 80px; min-height: 220px; }
  .cover h1 { font-size: 2.2rem; font-weight: 700; letter-spacing: -0.5px; }
  .cover .sub { font-size: 1rem; color: #94a3b8; margin-top: 8px; }
  .cover .meta { margin-top: 20px; font-size: 0.85rem; color: #64748b; }
  .content { max-width: 1000px; margin: 0 auto; padding: 40px 40px 80px; }
  h2 { font-size: 1.3rem; font-weight: 700; color: #0f172a; border-left: 4px solid #3b82f6; padding-left: 12px; margin: 40px 0 16px; }
  h3 { font-size: 1rem; font-weight: 600; color: #1e293b; margin: 20px 0 8px; }
  p { line-height: 1.7; color: #374151; margin-bottom: 12px; }
  ul { margin: 8px 0 16px 20px; }
  li { line-height: 1.7; color: #374151; margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 0.88rem; }
  th { background: #0f172a; color: white; padding: 10px 12px; text-align: left; font-weight: 600; }
  td { padding: 9px 12px; border-bottom: 1px solid #e5e7eb; }
  tr:nth-child(even) td { background: #f8fafc; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 0.78rem; font-weight: 600; }
  .badge-critical { background: #fee2e2; color: #991b1b; }
  .badge-high { background: #ffedd5; color: #9a3412; }
  .badge-medium { background: #fef9c3; color: #854d0e; }
  .badge-low { background: #dcfce7; color: #166534; }
  .badge-insufficient { background: #f3f4f6; color: #374151; }
  .disclaimer { background: #fef3c7; border: 1px solid #fbbf24; border-radius: 8px; padding: 16px 20px; margin-top: 40px; font-size: 0.85rem; color: #78350f; }
  .stat-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin: 20px 0; }
  .stat-card { background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; text-align: center; }
  .stat-card .num { font-size: 1.8rem; font-weight: 700; }
  .stat-card .lbl { font-size: 0.75rem; color: #6b7280; margin-top: 4px; }
  .num-critical { color: #dc2626; }
  .num-high { color: #ea580c; }
  .num-medium { color: #ca8a04; }
  .num-low { color: #16a34a; }
  .checklist li { list-style: none; margin-left: -20px; padding-left: 24px; position: relative; }
  .checklist li::before { content: "☐ "; position: absolute; left: 0; }
  @media print { body { background: white; } .cover { -webkit-print-color-adjust: exact; } }
</style>
</head>
<body>
<div class="cover">
  <div class="sub">POLYMATH INFRASHIELD BENGALURU</div>
  <h1>Critical Infrastructure Continuity Risk Report</h1>
  <div class="sub">Bengaluru Urban Area — Decision-Support Assessment</div>
  <div class="meta">Generated: {{ generated_at }} &nbsp;|&nbsp; Data: Synthetic Demo &nbsp;|&nbsp; Prepared by: Polymath InfraShield</div>
</div>

<div class="content">

<h2>1. Executive Summary</h2>
<p>This report presents a continuity risk assessment of <strong>{{ total_facilities }} critical facilities</strong> across the Bengaluru Urban District. The analysis applies a weighted multi-factor scoring model to identify which facilities face the greatest operational disruption risk from power failure, flood exposure, backup system gaps, water dependency, road access constraints, and heat stress.</p>
<p>Of the facilities assessed, <strong>{{ critical_count }} are classified Critical</strong>, <strong>{{ high_count }} High</strong>, <strong>{{ medium_count }} Medium</strong>, and <strong>{{ low_count }} Low</strong>. A further <strong>{{ insufficient_count }} facilities</strong> have insufficient data confidence for reliable scoring and require field verification.</p>
<div class="stat-grid">
  <div class="stat-card"><div class="num num-critical">{{ critical_count }}</div><div class="lbl">Critical</div></div>
  <div class="stat-card"><div class="num num-high">{{ high_count }}</div><div class="lbl">High Risk</div></div>
  <div class="stat-card"><div class="num num-medium">{{ medium_count }}</div><div class="lbl">Medium Risk</div></div>
  <div class="stat-card"><div class="num num-low">{{ low_count }}</div><div class="lbl">Low Risk</div></div>
  <div class="stat-card"><div class="num" style="color:#6b7280">{{ insufficient_count }}</div><div class="lbl">Insufficient Data</div></div>
</div>

<h2>2. Scope and Method</h2>
<p>The assessment covers hospitals, water utilities, fire and police stations, tech parks, industrial estates, transport hubs, power substations, and public relief facilities. The Continuity Risk Score (CRS) is calculated as a weighted composite of eight risk factors:</p>
<ul>
  <li><strong>20%</strong> Facility Criticality — population served, function criticality</li>
  <li><strong>20%</strong> Power Dependency — reliance on grid power</li>
  <li><strong>15%</strong> Backup Readiness Gap — DG/UPS adequacy (inverted)</li>
  <li><strong>15%</strong> Flood / Drainage Exposure — proximity to flood-risk areas</li>
  <li><strong>10%</strong> Water Dependency Risk — borewell / tanker reliance</li>
  <li><strong>10%</strong> Road / Emergency Access Risk — congestion and access constraints</li>
  <li><strong>5%</strong> Heat Exposure — urban heat island and climate risk</li>
  <li><strong>5%</strong> Data Confidence Adjustment — data quality penalty</li>
</ul>
<p>Risk levels: 0–30 Low | 31–55 Medium | 56–75 High | 76–100 Critical. Facilities with data confidence below 50 are flagged as Insufficient Data regardless of score.</p>

<h2>3. Top 10 Vulnerable Facilities</h2>
<table>
  <tr><th>#</th><th>Facility</th><th>Zone</th><th>Type</th><th>CRS</th><th>Risk Level</th></tr>
  {% for i, f in top10 %}
  <tr>
    <td>{{ i }}</td>
    <td><strong>{{ f.name }}</strong></td>
    <td>{{ f.zone }}</td>
    <td>{{ f.facility_type.replace('_', ' ').title() }}</td>
    <td><strong>{{ f.continuity_risk_score }}</strong></td>
    <td><span class="badge badge-{{ f.risk_level.lower().replace(' ', '-') }}">{{ f.risk_level }}</span></td>
  </tr>
  {% endfor %}
</table>

<h2>4. Zone-Level Risk Observations</h2>
{% for zone, stats in zone_summary.items() %}
<h3>{{ zone }}</h3>
<p>{{ stats.count }} facilities assessed. Average CRS: <strong>{{ stats.avg_score }}</strong>. Highest risk: <strong>{{ stats.top_facility }}</strong> ({{ stats.top_score }}).</p>
{% endfor %}

<h2>5. Critical Dependency Themes</h2>
<ul>
{% for theme in critical_themes %}
  <li>{{ theme }}</li>
{% endfor %}
</ul>

<h2>6. Data Confidence Gaps</h2>
<p>The following gaps limit analytical confidence and should be prioritised for field resolution:</p>
<ul>
{% for gap in data_gaps %}
  <li>{{ gap }}</li>
{% endfor %}
</ul>

<h2>7. Immediate Verification Checklist</h2>
<ul class="checklist">
{% for item in verification_checklist %}
  <li>{{ item }}</li>
{% endfor %}
</ul>

<h2>8. Recommended 30-Day Actions</h2>
<ul>
{% for action in actions_30 %}
  <li>{{ action }}</li>
{% endfor %}
</ul>

<h2>9. Recommended 90-Day Actions</h2>
<ul>
{% for action in actions_90 %}
  <li>{{ action }}</li>
{% endfor %}
</ul>

<h2>10. Disclaimer</h2>
<div class="disclaimer">
  <strong>Important:</strong> This report uses public, open, and synthetic demonstration data. All Continuity Risk Scores are decision-support indicators only and must be validated through field inspection, operator data, and official agency records (BESCOM, BWSSB, BBMP, Karnataka Health Department) before any operational, insurance, or planning use. Polymath InfraShield and ATBOSE accept no liability for decisions made solely on the basis of this illustrative assessment.
</div>

</div>
</body>
</html>"""


def generate_html_report(data: dict) -> str:
    template = Template(REPORT_TEMPLATE)
    top10 = [(i + 1, f) for i, f in enumerate(data["top_10_facilities"])]

    zone_summary = {}
    for zone, stats in data["zone_risk_summary"].items():
        zone_summary[zone] = type("Z", (), {
            "count": stats["count"],
            "avg_score": stats["avg_score"],
            "top_facility": stats["top_facility"],
            "top_score": stats["top_score"],
        })()

    return template.render(
        generated_at=data["generated_at"],
        total_facilities=data["total_facilities"],
        critical_count=data["critical_count"],
        high_count=data["high_count"],
        medium_count=data["medium_count"],
        low_count=data["low_count"],
        insufficient_count=data["insufficient_data_count"],
        top10=top10,
        zone_summary=zone_summary,
        critical_themes=data["critical_themes"],
        data_gaps=data["data_confidence_gaps"],
        verification_checklist=data["verification_checklist"],
        actions_30=data["actions_30_day"],
        actions_90=data["actions_90_day"],
    )
