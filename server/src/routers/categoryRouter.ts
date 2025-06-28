import { TRPCError } from '@trpc/server';
import mongoose, { Types } from 'mongoose';
import { z } from 'zod';
import { CategoryModel } from '../models/category';
import { resetCategoriesToDefault } from '../services/category-resetting/categoryResettingService';

import { publicProcedure, router } from '../trpc';
import { verifyToken } from './auth';

const objectIdToStringSchema = z
  .custom<Types.ObjectId | string>((val) => Types.ObjectId.isValid(val as any))
  .transform((val) => val.toString());

const categorySchema = z.object({
  _id: objectIdToStringSchema,
  userId: objectIdToStringSchema,
  name: z.string(),
  description: z.string().optional(),
  color: z.string(),
  isProductive: z.boolean(),
  isDefault: z.boolean().default(false),
  isArchived: z.boolean().optional().default(false),
  isLikelyToBeOffline: z.boolean().optional().default(false),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const categoryRouter = router({
  createCategory: publicProcedure
    .input(
      z.object({
        token: z.string(),
        name: z.string().min(1, 'Name is required'),
        description: z.string().optional(),
        color: z.string().regex(/^#[0-9A-F]{6}$/i, 'Invalid color format (e.g., #FF5733)'),
        isProductive: z.boolean(),
        isDefault: z.boolean().optional(),
        isLikelyToBeOffline: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const decodedToken = verifyToken(input.token);
      const userId = decodedToken.userId;
      const {
        name,
        description,
        color,
        isProductive,
        isDefault = false,
        isLikelyToBeOffline = false,
      } = input;

      const existingCategory = await CategoryModel.findOne({ userId, name });
      if (existingCategory) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'A category with this name already exists.',
        });
      }

      const category = new CategoryModel({
        userId,
        name,
        description,
        color,
        isProductive,
        isDefault,
        isLikelyToBeOffline,
      });
      await category.save();
      return category.toJSON();
    }),

  getCategories: publicProcedure
    .input(z.object({ token: z.string() }))
    .output(z.array(categorySchema))
    .query(async ({ input }) => {
      const decodedToken = verifyToken(input.token);
      const userId = decodedToken.userId;
      const categories = await CategoryModel.find({ userId }).sort({ createdAt: -1 });
      return categories.map((cat) => cat.toJSON());
    }),

  updateCategory: publicProcedure
    .input(
      z.object({
        token: z.string(),
        id: z.string().refine((val) => mongoose.Types.ObjectId.isValid(val), {
          message: 'Invalid Object ID',
        }),
        name: z.string().min(1, 'Name is required').optional(),
        description: z.string().optional(),
        color: z
          .string()
          .regex(/^#[0-9A-F]{6}$/i, 'Invalid color format')
          .optional(),
        isProductive: z.boolean().optional(),
        isArchived: z.boolean().optional(),
        isLikelyToBeOffline: z.boolean().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const decodedToken = verifyToken(input.token);
      const userId = decodedToken.userId;
      const { id, ...updateData } = input;

      const { token, ...restOfUpdateData } = updateData as any;

      const category = await CategoryModel.findOne({ _id: id, userId });

      if (!category) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Category not found' });
      }

      if (restOfUpdateData.name && restOfUpdateData.name !== category.name) {
        const existingCategory = await CategoryModel.findOne({
          userId,
          name: restOfUpdateData.name,
          _id: { $ne: id },
        });
        if (existingCategory) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Another category with this name already exists.',
          });
        }
      }

      Object.assign(category, restOfUpdateData);
      await category.save();
      return category.toJSON();
    }),

  deleteCategory: publicProcedure
    .input(
      z.object({
        token: z.string(),
        id: z.string().refine((val) => mongoose.Types.ObjectId.isValid(val), {
          message: 'Invalid Object ID',
        }),
      })
    )
    .mutation(async ({ input }) => {
      const decodedToken = verifyToken(input.token);
      const userId = decodedToken.userId;
      const { id } = input;

      const category = await CategoryModel.findOneAndDelete({ _id: id, userId });

      if (!category) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Category not found' });
      }
      return category.toJSON();
    }),

  resetToDefault: publicProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ input }) => {
      const decodedToken = verifyToken(input.token);
      const userId = decodedToken.userId;
      await resetCategoriesToDefault(userId);
      return { success: true };
    }),

  getCategoryById: publicProcedure
    .input(
      z.object({
        token: z.string(),
        categoryId: z.string().refine((val) => mongoose.Types.ObjectId.isValid(val), {
          message: 'Invalid Object ID for categoryId',
        }),
      })
    )
    .query(async ({ input }) => {
      verifyToken(input.token);
      const { categoryId } = input;

      const category = await CategoryModel.findById(categoryId);

      if (!category) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Category not found',
        });
      }
      return category.toJSON();
    }),
});

export type CategoryRouter = typeof categoryRouter;
