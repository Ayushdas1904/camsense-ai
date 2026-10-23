import { apiClient } from './apiClient';
import type { ApiSuccess, RecognitionEvent } from '@/types';

interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}

export interface RecognitionEventQuery {
  cameraId?: string;
  status?: string;
  personId?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

/**
 * Recognition-event API surface (Review 2) — READ ONLY by design.
 *
 * Events are written only by the trusted recognition workflow; a client must
 * never be able to assert that a recognition happened. Responses carry no
 * embedding, and a personName is present only on a verified `known` event.
 */
export const recognitionService = {
  async list(params: RecognitionEventQuery = {}): Promise<Paged<RecognitionEvent>> {
    const { data } = await apiClient.get<ApiSuccess<Paged<RecognitionEvent>>>(
      '/recognition-events',
      { params }
    );
    return data.data;
  },

  async get(id: string): Promise<RecognitionEvent> {
    const { data } = await apiClient.get<ApiSuccess<RecognitionEvent>>(`/recognition-events/${id}`);
    return data.data;
  },
};
