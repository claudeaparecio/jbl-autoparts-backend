const Product = require("../../models/product.model");
const SKUChunk = require("../../models/sku-chunk.model");
const SKU = require("../../models/sku.model");
const ErrorCodes = require("../../utils/ErrorCodes");
const uploadToCloudinary = require("../../utils/uploadToCloudinary");


const getProductById = async (req, res, next) => {
  try {
    const { productId } = req.params;

    const [product, productVariants] = await Promise.all([
      Product.findOne({ _id: productId, is_deleted: false })
        .populate({
          path: "sku",
          populate: { path: "skuChunks", options: { sort: { order: 1 } } },
        })
        .lean(),
      Product.find({ parentId: productId, is_deleted: false }).lean(),
    ]);

    const chunks = product?.sku?.skuChunks || [];
    const skuString = chunks.map((chunk) => chunk.chunk).join("-");

    return res.json({
      status: "success",
      data: {
        product: { ...product, sku: skuString, variants: productVariants },
      },
    });
  } catch (error) {
    next(error);
  }
};

const getProducts = async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const search = req.query.search?.trim();
    const status = req.query.status?.trim();
    const noVariant = req.query.noVariant?.trim() === "true";

    const searchTerms = search ? search.split(/\s+/).filter(Boolean) : [];

    const searchableFields = ["name", "description", "uniqueCode", "partNumber", "brand", "tags"];

    const searchFilter = searchTerms.length ?
      {
        $or: searchTerms.flatMap((term) =>
          searchableFields.map((field) => {
            if (field === "tags") {
              return { tags: { $in: [new RegExp(term, "i")] } };
            }
            return { [field]: { $regex: term, $options: "i" } };
          })
        ),
      }
      : {};

    const filter = {
      is_deleted: false,
      ...(status && { status: { $regex: `^${status}$`, $options: "i" } }),
      ...searchFilter,
      ...(noVariant && { parentId: null }),
    };

    const [total, products] = await Promise.all([
      Product.countDocuments(filter),
      Product.aggregate([
      { $match: filter },
      {
        $addFields: {
          matchScore: {
            $sum: [
              ...searchTerms.flatMap((term) => [
                { $cond: [{ $regexMatch: { input: "$name", regex: term, options: "i" } }, 2, 0] },
                { $cond: [{ $regexMatch: { input: "$description", regex: term, options: "i" } }, 1, 0] },
                { $cond: [{ $regexMatch: { input: "$uniqueCode", regex: term, options: "i" } }, 2, 0] },
                { $cond: [{ $regexMatch: { input: "$partNumber", regex: term, options: "i" } }, 1, 0] },
                { $cond: [{ $regexMatch: { input: "$brand", regex: term, options: "i" } }, 1, 0] },
                {
                  $cond: [
                    {
                      $gt: [
                        {
                          $size: {
                            $filter: {
                              input: "$tags",
                              as: "tag",
                              cond: { $regexMatch: { input: "$$tag", regex: term, options: "i" } },
                            },
                          },
                        },
                        0,
                      ],
                    },
                    1,
                    0,
                  ],
                },
              ]),
            ],
          },
        },
      },
      { $sort: { matchScore: -1, createdAt: -1 } },
      { $skip: skip },
      { $limit: limit },
    ]),
    ]);

    const formattedProducts = products.map((product) => {
      // @ts-ignore
      const chunks = product.sku?.skuChunks || [];
      const skuString = chunks.map((chunk) => chunk.chunk).join("-");
      return {
        ...product,
        sku: skuString,
      };
    });

    return res.json({
      status: "success",
      data: {
        products: formattedProducts,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    next(error);
  }
};

const createProduct = async (req, res) => {
  try {
    const uploadedFiles = req.files || [];
    const existingImages = req.body.existingImages
      ? JSON.parse(req.body.existingImages)
      : [];
    const newImagePaths = await Promise.all(
      uploadedFiles.map((file) => uploadToCloudinary(file.buffer, file.originalname))
    );

    const finalImages = [...existingImages, ...newImagePaths];
    const {
      description,
      name,
      uniqueCode,
      price,
      quantityRemaining,
      quantitySold,
      sku,
      tags,
      partNumber,
      brand,
      parentId,
      quantityThreshold,
    } = req.body;

    const skuParts = sku.split("-");
    let chunkDocs = [];

    if (sku && skuParts.length > 0) {
      chunkDocs = await Promise.all(
        skuParts.map(async (part, index) => {
          let chunk = await SKUChunk.findOne({ chunk: part, order: index });

          if (!chunk) {
            chunk = await SKUChunk.create({ chunk: part, order: index });
          }

          return chunk;
        })
      );
    }

    const chunkIds = chunkDocs.map(c => c._id.toString());

    let matchingSKU = await SKU.findOne({
      skuChunks: { $size: chunkIds.length, $all: chunkIds },
    });

    if (!matchingSKU && sku) {
      matchingSKU = await SKU.create({ skuChunks: chunkIds });
    }

    const status = quantityRemaining <= quantityThreshold ? 'low_in_stock' : 'available';

    const product = await Product.create({
      name,
      description,
      images: finalImages,
      uniqueCode,
      price,
      quantityRemaining,
      quantityThreshold,
      quantitySold,
      partNumber,
      status,
      sku: matchingSKU?._id,
      tags,
      brand,
      parentId,
    });

    return res.json({
      status: "success",
      data: {
        _id: product.id,
        name,
        description,
        images: finalImages,
        uniqueCode,
        price,
        quantityRemaining,
        quantitySold,
        partNumber,
        status: "available",
        tags,
        brand,
        parentId,
        sku,
      },
    });
  } catch (error) {
    return res.status(ErrorCodes.INTERNAL_SERVER_ERROR).json({
      status: "failed",
      message: error.message,
    });
  }
}

const updateProduct = async (req, res) => {
  try {
    const { productId } = req.params;
    const body = { ...req.body };
    const uploadedFiles = req.files || [];
    const existingImages = req.body.existingImages
      ? JSON.parse(req.body.existingImages)
      : [];
    const newImagePaths = await Promise.all(
      uploadedFiles.map((file) =>
        uploadToCloudinary(file.buffer, file.originalname)
      )
    );
    const finalImages = [...existingImages, ...newImagePaths];
    body.images = finalImages;

    delete body.existingImages;

    const existingProduct = await Product.findById(productId);

    if (!existingProduct) {
      return res.status(404).json({
        message: "Product not found."
      });
    }

    // *** To be investigated, if we should delete image assets ***
    // const imagesToDelete = (existingProduct.images || []).filter(oldImage => 
    //   !finalImages.includes(oldImage)
    // );
    // 
    // for (const imgPath of imagesToDelete) {
    //   const absolutePath = path.join(__dirname, '../../../', imgPath);
    //   fs.unlink(absolutePath, (err) => {
    //     if (err) {
    //       console.error(`Failed to delete image: ${absolutePath}`, err);
    //     } else {
    //       console.log(`Deleted old image: ${absolutePath}`);
    //     }
    //   });
    // }

    const skuParts = body?.sku?.split("-");

    if (body.sku && typeof body.sku === "string") {
      const chunkDocs = await Promise.all(
        skuParts.map(async (part, index) => {
          let chunk = await SKUChunk.findOne({ chunk: part, order: index });

          if (!chunk) {
            chunk = await SKUChunk.create({ chunk: part, order: index });
          }

          return chunk;
        })
      );

      const chunkIds = chunkDocs.map(c => c._id.toString());

      let matchingSKU = await SKU.findOne({
        skuChunks: { $size: chunkIds.length, $all: chunkIds },
      });

      if (!matchingSKU) {
        matchingSKU = await SKU.create({ skuChunks: chunkIds });
      }

      body.sku = matchingSKU._id;
    } else {
      delete body.sku;
    }
    

    if (body.quantityRemaining <= body.quantityThreshold) {
      body.status = 'low_in_stock'
    } else if (body.quantityRemaining === 0) {
      body.status = 'out_of_stock'
    } else {
      body.status = 'available'
    }

    const updatedProduct = await Product.findByIdAndUpdate(
      productId,
      body,
      {
        new: true,
        runValidators: true
      }
    ).populate({
      path: "sku",
      populate: {
        path: "skuChunks",
        options: { sort: { order: 1 } },
      },
    }).lean();

    if (!updatedProduct) {
      return res.status(404).json({
        message: "Product not found."
      });
    }

    const chunks = updatedProduct.sku?.skuChunks || [];
    const skuString = chunks.map((chunk) => chunk.chunk).join("-");

    res.status(200).json({
      message: "Product updated successfully.",
      data: {
        ...updatedProduct,
        sku: skuString || ""
      }
    });
  } catch (error) {
    return res.status(ErrorCodes.INTERNAL_SERVER_ERROR).json({
      status: "failed",
      message: error.message,
    });
  }
};


const deleteProduct = async (req, res, next) => {
  try {
    const { productId } = req.params;

    const result = await Product.findOneAndUpdate(
      { _id: productId, is_deleted: false },
      { is_deleted: true }
    ).lean();

    if (!result) {
      return res.status(404).json({ message: "Product not found." });
    }

    res.status(200).json({ message: "Success." });
  } catch (error) {
    return res.status(ErrorCodes.INTERNAL_SERVER_ERROR).json({
      status: "failed",
      message: error.message,
    });
  }
};

const getAllProductsByStatus = async (req, res) => {
  try {
    const status = req.query.status;

    const productsFilter = {
      is_deleted: false,
      ...(status && { status })
    }
    const products = await Product.find(productsFilter)
      .sort({ name: 1 })
      .select("name price status quantityRemaining quantityThreshold quantitySold brand partNumber uniqueCode sku tags images parentId")
      .lean();

    return res.status(200).json({
      status: 'success',
      data: products,
    });
  } catch (error) {
    console.error('Error fetching products:', error);
    return res.status(500).json({
      status: 'failed',
      message: error.message,
    });
  }
};

const getProductStatistics = async (req, res, next) => {
  try {
    const [result] = await Product.aggregate([
      { $match: { is_deleted: false } },
      {
        $facet: {
          active:      [{ $match: { status: "available" } },    { $count: "count" }],
          lowStock:    [{ $match: { status: "low_in_stock" } }, { $count: "count" }],
          outOfStock:  [{ $match: { status: "out_of_stock" } }, { $count: "count" }],
          inventoryValue: [
            { $match: { quantityRemaining: { $gt: 0 } } },
            { $group: { _id: null, total: { $sum: { $multiply: ["$quantityRemaining", "$price"] } } } },
          ],
        },
      },
    ]);

    return res.json({
      status: "success",
      data: {
        active_products:       result.active[0]?.count      ?? 0,
        low_stock:             result.lowStock[0]?.count    ?? 0,
        out_of_stock:          result.outOfStock[0]?.count  ?? 0,
        total_inventory_value: result.inventoryValue[0]?.total ?? 0,
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  getProductById,
  getAllProductsByStatus,
  getProductStatistics,
};