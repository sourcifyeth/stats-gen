export interface ContractsPerChain {
  chain_id: number;
  partial: number;
  full: number;
}

export interface Manifest {
  timestamp: number;
  dateString: string;
  version?: "1" | "2";
}

export interface Stats {
  [chainId: number]: {
    full_match: number;
    partial_match: number;
  };
}
