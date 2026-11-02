import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/sequelize';
import { Op, UniqueConstraintError } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import { ExerciseNoteService } from './exercise-note.service';
import { Exercise } from './entities/exercise.entity';
import { ExerciseNote } from './entities/exercise-note.entity';
import { ExerciseSource, ExerciseVisibility } from './entities/exercise.enums';

describe('ExerciseNoteService — the private note per exercise', () => {
  let service: ExerciseNoteService;

  const noteModel = {
    findOne: jest.fn(),
    findAll: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
  };
  const exerciseModel = { findByPk: jest.fn() };
  const sequelize = { query: jest.fn() };

  const system = {
    id: 'ex-sys',
    source: ExerciseSource.System,
    visibility: ExerciseVisibility.Public,
    ownerId: null,
  };
  const coachPrivate = {
    id: 'ex-coach',
    source: ExerciseSource.Instructor,
    visibility: ExerciseVisibility.Private,
    ownerId: 'coach-1',
  };
  const updatedAt = new Date('2026-11-02T09:30:00Z');

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        ExerciseNoteService,
        { provide: getModelToken(ExerciseNote), useValue: noteModel },
        { provide: getModelToken(Exercise), useValue: exerciseModel },
        { provide: Sequelize, useValue: sequelize },
      ],
    }).compile();
    service = module.get(ExerciseNoteService);
  });

  describe('get', () => {
    it('answers null when there is no note', async () => {
      exerciseModel.findByPk.mockResolvedValueOnce(system);
      noteModel.findOne.mockResolvedValueOnce(null);

      await expect(service.get('ex-sys', 'me')).resolves.toEqual({
        exerciseId: 'ex-sys',
        note: null,
        updatedAt: null,
      });
      expect(noteModel.findOne).toHaveBeenCalledWith({
        where: { userId: 'me', exerciseId: 'ex-sys' },
      });
    });

    it("404s on someone else's private exercise that never reached them", async () => {
      exerciseModel.findByPk.mockResolvedValueOnce(coachPrivate);
      sequelize.query.mockResolvedValueOnce([]);

      await expect(service.get('ex-coach', 'me')).rejects.toThrow(
        NotFoundException,
      );
      expect(noteModel.findOne).not.toHaveBeenCalled();
    });

    it("opens a coach's private exercise that came in their plan", async () => {
      exerciseModel.findByPk.mockResolvedValueOnce(coachPrivate);
      sequelize.query.mockResolvedValueOnce([{ found: 1 }]);
      noteModel.findOne.mockResolvedValueOnce({
        note: 'Elbows in',
        updatedAt,
      });

      await expect(service.get('ex-coach', 'me')).resolves.toEqual({
        exerciseId: 'ex-coach',
        note: 'Elbows in',
        updatedAt,
      });
    });

    it('404s on an exercise that does not exist', async () => {
      exerciseModel.findByPk.mockResolvedValueOnce(null);
      await expect(service.get('nope', 'me')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('put', () => {
    beforeEach(() => exerciseModel.findByPk.mockResolvedValue(system));

    it('writes a new note, trimmed', async () => {
      noteModel.findOne.mockResolvedValueOnce(null);
      noteModel.create.mockResolvedValueOnce({
        note: 'Seat on 4',
        updatedAt,
      });

      const out = await service.put('ex-sys', 'me', '  Seat on 4  ');

      expect(noteModel.create).toHaveBeenCalledWith({
        userId: 'me',
        exerciseId: 'ex-sys',
        note: 'Seat on 4',
      });
      expect(out).toEqual({
        exerciseId: 'ex-sys',
        note: 'Seat on 4',
        updatedAt,
      });
    });

    it('replaces the note that is there', async () => {
      const row = {
        note: 'Seat on 3',
        updatedAt,
        update: jest.fn(function (
          this: { note: string },
          fields: { note: string },
        ) {
          this.note = fields.note;
          return Promise.resolve();
        }),
      };
      noteModel.findOne.mockResolvedValueOnce(row);

      const out = await service.put('ex-sys', 'me', 'Seat on 4');

      expect(row.update).toHaveBeenCalledWith({ note: 'Seat on 4' });
      expect(noteModel.create).not.toHaveBeenCalled();
      expect(out.note).toBe('Seat on 4');
    });

    it.each([[''], ['   '], [null], [undefined]])(
      'deletes the note when sent %p',
      async (note) => {
        const out = await service.put('ex-sys', 'me', note);

        expect(noteModel.destroy).toHaveBeenCalledWith({
          where: { userId: 'me', exerciseId: 'ex-sys' },
        });
        expect(noteModel.create).not.toHaveBeenCalled();
        expect(out).toEqual({
          exerciseId: 'ex-sys',
          note: null,
          updatedAt: null,
        });
      },
    );

    it('keeps the note when two saves race to create it', async () => {
      noteModel.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ note: 'Seat on 4', updatedAt });
      noteModel.create.mockRejectedValueOnce(new UniqueConstraintError({}));

      const out = await service.put('ex-sys', 'me', 'Seat on 4');

      expect(noteModel.update).toHaveBeenCalledWith(
        { note: 'Seat on 4' },
        { where: { userId: 'me', exerciseId: 'ex-sys' } },
      );
      expect(out.note).toBe('Seat on 4');
    });
  });

  describe('notesFor', () => {
    it('reads every exercise of a workout in one query', async () => {
      noteModel.findAll.mockResolvedValueOnce([
        { exerciseId: 'ex-1', note: 'Seat on 4' },
      ]);

      const notes = await service.notesFor('me', ['ex-1', 'ex-2', 'ex-1']);

      expect(noteModel.findAll).toHaveBeenCalledTimes(1);
      expect(noteModel.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'me', exerciseId: { [Op.in]: ['ex-1', 'ex-2'] } },
        }),
      );
      expect(notes.get('ex-1')).toBe('Seat on 4');
      expect(notes.has('ex-2')).toBe(false);
    });

    it('asks nothing for a workout with no exercises', async () => {
      await expect(service.notesFor('me', [])).resolves.toEqual(new Map());
      expect(noteModel.findAll).not.toHaveBeenCalled();
    });
  });
});
