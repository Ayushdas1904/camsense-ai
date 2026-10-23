import { apiClient } from './apiClient';
import type { ApiSuccess, FaceRegistrationResult, Person, PersonInput } from '@/types';

interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

export interface PeopleQuery {
  search?: string;
  category?: string;
  recognitionEnabled?: boolean;
  active?: boolean;
  page?: number;
  limit?: number;
}

/**
 * Person API surface (Review 2). All person HTTP lives here — components never
 * call apiClient or axios directly.
 *
 * The frontend talks only to the Node backend; it never calls the Python AI
 * service and never holds an internal service credential. Face embeddings are
 * never requested or received here: readiness arrives as the derived
 * `faceRegistered` / `recognitionReady` booleans on Person.
 */
export const peopleService = {
  async list(params: PeopleQuery = {}): Promise<Paged<Person>> {
    const { data } = await apiClient.get<ApiSuccess<Paged<Person>>>('/people', { params });
    return data.data;
  },

  /** `id` may be a Mongo _id or a human personId — the backend resolves both. */
  async get(id: string): Promise<Person> {
    const { data } = await apiClient.get<ApiSuccess<Person>>(`/people/${id}`);
    return data.data;
  },

  async create(input: PersonInput): Promise<Person> {
    const { data } = await apiClient.post<ApiSuccess<Person>>('/people', input);
    return data.data;
  },

  async update(id: string, input: Partial<PersonInput>): Promise<Person> {
    const { data } = await apiClient.put<ApiSuccess<Person>>(`/people/${id}`, input);
    return data.data;
  },

  /** Enable or disable recognition for a person (admin only, server-enforced). */
  async setRecognition(id: string, recognitionEnabled: boolean): Promise<Person> {
    const { data } = await apiClient.patch<ApiSuccess<Person>>(`/people/${id}/recognition`, {
      recognitionEnabled,
    });
    return data.data;
  },

  /**
   * Remove a person. `deactivate: true` performs a soft delete that keeps the
   * attendance history readable while making the person unmatchable; a hard
   * delete additionally clears the stored embedding and the photograph file.
   */
  async remove(id: string, options: { deactivate?: boolean } = {}): Promise<void> {
    await apiClient.delete(`/people/${id}`, {
      params: options.deactivate ? { deactivate: 'true' } : undefined,
    });
  },

  /**
   * Enroll a face. The photograph is sent as a base64 image DATA URL in a JSON
   * body, matching the backend's chosen upload contract (see the transport
   * tradeoff comment on registerPersonFace in personController.js).
   *
   * A longer timeout than the shared client default is used on purpose: the
   * first call may initialise the recognition model inside the AI service.
   */
  async registerFace(id: string, imageDataUrl: string): Promise<FaceRegistrationResult> {
    const { data } = await apiClient.post<ApiSuccess<FaceRegistrationResult>>(
      `/people/${id}/face-registration`,
      { image: imageDataUrl },
      { timeout: 60000 }
    );
    return data.data;
  },
};
