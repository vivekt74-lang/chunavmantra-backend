// types/index.ts
export interface State {
    state_id: number;
    state_name: string;
    created_at?: Date;
    updated_at?: Date;
}

export interface AssemblyConstituency {
    ac_id: number;
    ac_name: string;
    ac_number: number;
    state_id: number;
    district_name: string;
    total_electors: number;
    total_booths: number;
    category: string;
    parliament_seat: string;
    created_at?: Date;
    updated_at?: Date;
}

export interface Candidate {
    candidate_id: number;
    candidate_name: string;
    party_id: number;
    party_name?: string;
    party_symbol?: string;
    created_at?: Date;
    updated_at?: Date;
}

export interface ElectionResult {
    result_id: number;
    booth_id: number;
    candidate_id: number;
    election_id: number;
    election_year: number;
    votes_secured: number;
    created_at?: Date;
}

export interface Booth {
    booth_id: number;
    ac_id: number;
    booth_number: number;
    booth_name: string;
    total_electors: number;
    male_voters: number;
    female_voters: number;
    other_voters: number;
    created_at?: Date;
    updated_at?: Date;
}

export interface BoothTurnout {
    turnout_id: number;
    booth_id: number;
    election_id: number;
    total_electors: number;
    male_voters: number;
    female_voters: number;
    other_voters: number;
    total_votes_cast: number;
    created_at?: Date;
}

export interface Party {
    party_id: number;
    party_name: string;
    party_symbol: string;
    party_color?: string;
    created_at?: Date;
    updated_at?: Date;
}

export interface ElectionSummary {
    ac_name: string;
    total_booths: number;
    total_votes: number;
    winning_candidate: string;
    winning_party: string;
    winning_votes: number;
    victory_margin: number;
    turnout_percentage: number;
}

// API Response Types
export interface ApiResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
    message?: string;
    meta?: {
        page?: number;
        limit?: number;
        total?: number;
        totalPages?: number;
    };
}