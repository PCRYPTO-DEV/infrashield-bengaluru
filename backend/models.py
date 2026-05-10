from pydantic import BaseModel, Field
from typing import Literal, Optional
from datetime import datetime

RiskLevel = Literal["Low", "Medium", "High", "Critical", "Insufficient Data"]
OwnerType = Literal["public", "private", "unknown"]


class FacilityBase(BaseModel):
    name: str
    facility_type: str
    latitude: float
    longitude: float
    zone: str
    owner_type: OwnerType = "unknown"
    criticality_score: float = Field(ge=0, le=100)
    power_dependency_score: float = Field(ge=0, le=100)
    backup_readiness_score: float = Field(ge=0, le=100)
    flood_exposure_score: float = Field(ge=0, le=100)
    water_dependency_score: float = Field(ge=0, le=100)
    road_access_score: float = Field(ge=0, le=100)
    heat_exposure_score: float = Field(ge=0, le=100)
    data_confidence_score: float = Field(ge=0, le=100)
    assumptions: list[str] = []
    data_sources: list[str] = []


class FacilityCreate(FacilityBase):
    pass


class FacilityModel(FacilityBase):
    id: str
    continuity_risk_score: float
    risk_level: RiskLevel
    main_risk_drivers: list[str]
    recommended_actions: list[str]
    last_updated: str

    class Config:
        from_attributes = True


class RiskZoneProperties(BaseModel):
    zone_id: str
    name: str
    risk_type: str
    severity: str
    description: str


class PowerAsset(BaseModel):
    id: str
    name: str
    asset_type: str
    latitude: float
    longitude: float
    zone: str
    capacity_mva: Optional[float] = None
    feeder_count: Optional[int] = None
    reliability_score: Optional[float] = None


class ReportSummary(BaseModel):
    generated_at: str
    total_facilities: int
    critical_count: int
    high_count: int
    medium_count: int
    low_count: int
    insufficient_data_count: int
    top_10_facilities: list[FacilityModel]
    zone_risk_summary: dict[str, dict]
    critical_themes: list[str]
    data_confidence_gaps: list[str]
    verification_checklist: list[str]
    actions_30_day: list[str]
    actions_90_day: list[str]
    disclaimer: str


class FacilityReport(BaseModel):
    facility: FacilityModel
    generated_at: str
    executive_summary: str
    risk_narrative: str
    mitigation_plan: list[str]
    verification_items: list[str]
    disclaimer: str


class UploadResult(BaseModel):
    uploaded: int
    failed: int
    errors: list[str]
    facilities: list[FacilityModel]
