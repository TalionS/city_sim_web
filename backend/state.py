import numpy as np

class CityState:
    def __init__(self, N=1, M=2, H=100, rho0=0.5, m=0.7):
        self.N = N
        self.M = M
        self.H = H
        self.m = m
        self.turn = 0
        self.total_blocks = N * M
        self.occupied = self._init_city(rho0)
        self.delta_Us = np.zeros_like(self.occupied)
        self.delta_us = np.zeros_like(self.occupied)


    def _init_city(self, rho0):
        total = int(self.total_blocks * self.H * rho0)
        occ = np.zeros(self.total_blocks, dtype=int)
        idxs = np.random.choice(self.total_blocks, total, replace=True)
        for i in idxs:
            if occ[i] < self.H:
                occ[i] += 1
        return occ

    def u(self, rho):
        rho = np.clip(rho, 1e-6, 1 - 1e-6)
        return np.where(rho <= 0.5, 2 * rho, self.m + 2 * (1 - self.m) * (1 - rho))

    def compute_metrics(self, from_idx=None):
        densities = self.occupied / self.H
        # utils = self.u(densities)

        u_current = self.u(densities)
        total_U = self.H * np.sum(densities * u_current)

        self.delta_us = np.zeros_like(densities)
        self.delta_Us = np.zeros_like(densities)
        if from_idx is not None:
            u_from = u_current[from_idx]

            for i in range(self.total_blocks):
                if self.occupied[i] < self.H and i != from_idx:
                    rho_new = (self.occupied[i] + 1) / self.H
                    self.delta_us[i] = self.u(rho_new) - u_from

                    tmp_dens = densities.copy()
                    tmp_dens[i] += 1 / self.H
                    tmp_dens[from_idx] -= 1 / self.H
                    utils_tmp = self.u(tmp_dens)
                    new_U = self.H * np.sum(tmp_dens * utils_tmp)
                    self.delta_Us[i] = new_U - total_U

        return densities.tolist(), self.delta_us.tolist(), self.delta_Us.tolist()

    def move(self, from_idx, to_idx):
        if self.occupied[from_idx] > 0 and self.occupied[to_idx] < self.H:
            self.occupied[from_idx] -= 1
            self.occupied[to_idx] += 1
            self.turn += 1

    def to_dict(self, from_idx=None):
        densities, self.delta_us, self.delta_Us = self.compute_metrics(from_idx)
        return {
            "N": self.N,
            "M": self.M,
            "occupied": self.occupied.tolist(),
            "densities": densities,
            "delta_us": self.delta_us,
            "delta_Us": self.delta_Us,
            "social_utility": self.H * np.sum(densities * self.u(densities))
        }
    
    def get_random_agent_block(self):
        weights = np.array(self.occupied, dtype=float)
        total = np.sum(weights)
        if total == 0:
            return None
        probs = weights / total
        return int(np.random.choice(len(weights), p=probs))