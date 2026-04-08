export interface ICacheService {
    get<T>(key: string): T | null;
    set<T>(key: string, value: T, ttl?: number): void;
    has(key: string): boolean;
    delete(key: string): boolean;
    clear(): void;
    getOrSet<T>(key: string, factory: () => Promise<T>, ttl?: number): Promise<T>;
}
