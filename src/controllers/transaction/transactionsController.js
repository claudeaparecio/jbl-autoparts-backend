const Products = require("../../models/product.model");
const Transactions = require("../../models/transaction.model");
const ErrorCodes = require("../../utils/ErrorCodes");
const mongoose = require("mongoose");
const { getInvoiceId } = require("../../helpers/services");
const { ObjectId } = mongoose.Types;

const getMyTransactionStatistics = async (req, res) => {
  try {
    const userId = req.user?._id;

    const now = new Date();
    const startOfToday = new Date(now.setHours(0, 0, 0, 0));
    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    const endOfYesterday = new Date(startOfToday);

    const startOfWeek = new Date();
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    startOfWeek.setHours(0, 0, 0, 0);

    const startOfLastWeek = new Date(startOfWeek);
    startOfLastWeek.setDate(startOfLastWeek.getDate() - 7);
    const endOfLastWeek = new Date(startOfWeek);

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(startOfMonth);
    startOfLastMonth.setMonth(startOfLastMonth.getMonth() - 1);
    const endOfLastMonth = new Date(startOfMonth);

    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const startOfLastYear = new Date(startOfYear);
    startOfLastYear.setFullYear(startOfYear.getFullYear() - 1);
    const endOfLastYear = new Date(startOfYear);

    const matchUser = { cashier: new ObjectId(userId) };


    const pipeline = (startDate, endDate) => ([
      {
        $match: {
          ...matchUser,
          createdAt: { $gte: startDate, ...(endDate && { $lt: endDate }) },
          status: 'completed',
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$total" },
          transactionCount: { $sum: 1 },
          itemsSold: { $sum: { $sum: "$items.count" } },
          avgTransactionValue: { $avg: "$total" },
          avgItemsPerTransaction: { $avg: { $sum: "$items.count" } }
        }
      }
    ]);

    const [
      [todayStats],
      [yesterdayStats],
      [thisWeekStats],
      [lastWeekStats],
      [thisMonthStats],
      [lastMonthStats],
      [thisYearStats],
      [lastYearStats],
    ] = await Promise.all([
      Transactions.aggregate(pipeline(startOfToday)),
      Transactions.aggregate(pipeline(startOfYesterday, endOfYesterday)),
      Transactions.aggregate(pipeline(startOfWeek)),
      Transactions.aggregate(pipeline(startOfLastWeek, endOfLastWeek)),
      Transactions.aggregate(pipeline(startOfMonth)),
      Transactions.aggregate(pipeline(startOfLastMonth, endOfLastMonth)),
      Transactions.aggregate(pipeline(startOfYear)),
      Transactions.aggregate(pipeline(startOfLastYear, endOfLastYear)),
    ]);

    const formatStats = (stats = {}) => ({
      total: stats.total ?? 0,
      transactionCount: stats.transactionCount ?? 0,
      itemsSold: stats.itemsSold ?? 0,
      avgTransactionValue: stats.avgTransactionValue ?? 0,
      avgItemsPerTransaction: stats.avgItemsPerTransaction ?? 0
    });

    return res.json({
      status: "success",
      data: {
        today: formatStats(todayStats),
        yesterday: formatStats(yesterdayStats),
        thisWeek: formatStats(thisWeekStats),
        lastWeek: formatStats(lastWeekStats),
        thisMonth: formatStats(thisMonthStats),
        lastMonth: formatStats(lastMonthStats),
        thisYear: formatStats(thisYearStats),
        lastYear: formatStats(lastYearStats),
        changeTodayVsYesterday: ((todayStats?.total ?? 0) - (yesterdayStats?.total ?? 0)),
        changeMonthVsLast: ((thisMonthStats?.total ?? 0) - (lastMonthStats?.total ?? 0))
      }
    });
  } catch (error) {
    console.error('Error fetching transaction statistics:', error);
    return res.status(500).json({
      status: 'failed',
      message: error.message,
    });
  }
};

const getUserTransactions = async (req, res) => {
  try {
    const userId = req.user?._id;
    const isAdmin = req.query?.isAdmin === 'true';
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const search = req.query.search?.trim();

    if (!userId) {
      return res.status(400).json({ status: 'failed', message: 'User not authenticated' });
    }

    const transactionsFilter = {
      ...(!isAdmin && { cashier: userId }),
      ...(search && { invoiceId: { $regex: search, $options: "i" } })
    }

    const [total, transactions] = await Promise.all([
      Transactions.countDocuments(transactionsFilter),
      Transactions.find(transactionsFilter)
        .populate("items._id")
        .populate("partsman", "name")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    const transformed = transactions.map((txn) => ({
      ...txn,
      items: txn.items.map((item) => ({
        product: item._id,
        count: item.count,
      })),
    }));

    return res.status(200).json({
      status: 'success',
      data: transformed,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      }
    });
  } catch (error) {
    console.error('Error fetching user transactions:', error);
    return res.status(500).json({
      status: 'failed',
      message: error.message,
    });
  }
};

const getTransactions = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const search = req.query.search?.trim();

    const searchFilter = search
      ? { invoiceId: { $regex: search, $options: "i" } }
      : {};

    const [total, transactions] = await Promise.all([
      Transactions.countDocuments(searchFilter),
      Transactions.find(searchFilter)
        .populate("items._id")
        .populate("partsman", "name")
        .populate("cashier", "name")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    const response = transactions.map((txn) => ({
      ...txn,
      items: txn.items.map((item) => ({
        product: item._id,
        count: item.count,
      })),
    }));

    return res.status(200).json({
      status: "success",
      data: {
        transactions: response,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    return res.status(500).json({
      status: "failed",
      message: error.message,
    });
  }
};


const cancelTransaction = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { transactionId } = req.params;

    const transaction = await Transactions.findById(transactionId).session(session);
    if (!transaction) {
      throw new Error("Transaction not found.");
    }

    if (transaction.status === "cancelled") {
      throw new Error("Transaction already cancelled.");
    }

    const productIds = transaction.items.map((i) => i._id);
    const productDocs = await Products.find({ _id: { $in: productIds } }).session(session).lean();
    const productMap = new Map(productDocs.map((p) => [p._id.toString(), p]));

    await Promise.all(
      transaction.items.map(({ _id: productId, count }) => {
        const product = productMap.get(productId.toString());
        if (!product) throw new Error(`Product with ID ${productId} not found.`);

        const newQty = product.quantityRemaining + count;
        let status = "available";
        if (newQty === 0) status = "out_of_stock";
        else if (newQty <= product.quantityThreshold) status = "low_in_stock";

        return Products.findByIdAndUpdate(
          productId,
          { $inc: { quantityRemaining: count }, status },
          { session }
        );
      })
    );

    // Mark transaction as cancelled
    transaction.status = "cancelled";
    await transaction.save({ session });

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      status: "success",
      message: "Transaction successfully cancelled.",
      data: transaction,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    return res.status(500).json({
      status: "failed",
      message: error.message,
    });
  }
};

const returnTransaction = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { transactionId } = req.params;

    const transaction = await Transactions.findById(transactionId).session(session);
    if (!transaction) {
      throw new Error("Transaction not found.");
    }

    if (transaction.status !== "completed") {
      throw new Error("Only completed transactions can be returned.");
    }

    const productIds = transaction.items.map((i) => i._id);
    const productDocs = await Products.find({ _id: { $in: productIds } }).session(session).lean();
    const productMap = new Map(productDocs.map((p) => [p._id.toString(), p]));

    await Promise.all(
      transaction.items.map(({ _id: productId, count }) => {
        const product = productMap.get(productId.toString());
        if (!product) throw new Error(`Product with ID ${productId} not found.`);

        const newQty = product.quantityRemaining + count;
        let status = "available";
        if (newQty === 0) status = "out_of_stock";
        else if (newQty <= product.quantityThreshold) status = "low_in_stock";

        return Products.findByIdAndUpdate(
          productId,
          { $inc: { quantityRemaining: count }, status },
          { session }
        );
      })
    );

    // Update transaction status to 'returned'
    transaction.status = "returned";
    await transaction.save({ session });

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      status: "success",
      message: "Transaction successfully returned.",
      data: transaction,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    return res.status(500).json({
      status: "failed",
      message: error.message,
    });
  }
};


const createTransaction = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      items,
      cashier,
      total,
      discount,
      status,
      partsman,
    } = req.body;

    // Check stock and apply updates
    for (const { _id: productId, count } of items) {
      const product = await Products.findById(productId).session(session);

      if (!product) {
        throw new Error(`Product with ID ${productId} not found.`);
      }

      if (product.quantityRemaining < count) {
        throw new Error(`Not enough stock for ${product.name}.`);
      }

      const stockAfterDeduction = product.quantityRemaining - count;


      let status = 'available';
      if (stockAfterDeduction === 0) {
        status = 'out_of_stock';
      } else if (stockAfterDeduction === product.quantityThreshold) {
        status = 'low_in_stock';
      }

      await Products.findByIdAndUpdate(
        productId,
        {
          $inc: { quantityRemaining: -count },
          status
        },
        { session }
      );
    }

    // Create the transaction record
    const [transaction] = await Transactions.create(
      [{
        items,
        cashier,
        total,
        discount,
        status,
        partsman,
        invoiceId: getInvoiceId(new mongoose.Types.ObjectId()),
      }],
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    return res.status(201).json({
      status: "success",
      data: transaction,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    return res.status(500).json({
      status: "failed",
      message: error.message,
    });
  }
};

const updateTransaction = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { transactionId } = req.params;
    const {
      items,
      cashier,
      total,
      discount,
      status,
      partsman,
    } = req.body;

    const originalTransaction = await Transactions.findById(transactionId).session(session);
    if (!originalTransaction) {
      throw new Error("Transaction not found.");
    }

    // Validate allowed status transitions
    const validTransitions = {
      reserved: ['completed', 'cancelled'],
      completed: [],
      cancelled: [],
    };

    const currentStatus = originalTransaction.status;
    if (!validTransitions[currentStatus]?.includes(status) && currentStatus !== status) {
      throw new Error(`Invalid status transition from "${currentStatus}" to "${status}"`);
    }

    // Helper to compare items
    const itemsChanged = () => {
      if (originalTransaction.items.length !== items.length) return true;
      const mapOriginal = new Map(originalTransaction.items.map(i => [i._id.toString(), i.count]));
      for (const { _id, count } of items) {
        if (!mapOriginal.has(_id) || mapOriginal.get(_id) !== count) return true;
      }
      return false;
    };

    const shouldAdjustStock = status === 'completed' && currentStatus !== 'completed';
    const willChangeItems = itemsChanged();

    if (shouldAdjustStock && willChangeItems) {
      // Restore previous stock
      for (const { _id: productId, count } of originalTransaction.items) {
        await Products.findByIdAndUpdate(
          productId,
          { $inc: { quantityRemaining: count } },
          { session }
        );
      }

      // Deduct new stock
      for (const { _id: productId, count } of items) {
        const product = await Products.findById(productId).session(session);
        if (!product) throw new Error(`Product with ID ${productId} not found.`);
        if (product.quantityRemaining < count) {
          throw new Error(`Not enough stock for ${product.name}.`);
        }

        const remaining = product.quantityRemaining - count;

        let newStatus = 'available';
        if (remaining === 0) newStatus = 'out_of_stock';
        else if (remaining <= product.quantityThreshold) newStatus = 'low_in_stock';

        await Products.findByIdAndUpdate(
          productId,
          {
            $inc: { quantityRemaining: -count },
            status: newStatus,
          },
          { session }
        );
      }
    }

    const updatedTransaction = await Transactions.findByIdAndUpdate(
      transactionId,
      {
        items: items || originalTransaction.items,
        cashier: cashier || originalTransaction.cashier,
        total: total ?? originalTransaction.total,
        discount: discount ?? originalTransaction.discount,
        status: status || originalTransaction.status,
        partsman: partsman || originalTransaction.partsman,
      },
      { new: true, runValidators: true, session }
    );

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      status: "success",
      data: updatedTransaction,
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    return res.status(500).json({
      status: "failed",
      message: error.message,
    });
  }
};

const getTopSellingProducts = async (startDate, label) => {
  const result = await Transactions.aggregate([
    {
      $match: {
        status: "completed",
        createdAt: { $gte: startDate },
      },
    },
    { $unwind: "$items" },
    {
      $group: {
        _id: "$items._id",
        totalSold: { $sum: "$items.count" },
      },
    },
    { $sort: { totalSold: -1 } },
    { $limit: 50 },
    {
      $lookup: {
        from: "products",
        localField: "_id",
        foreignField: "_id",
        as: "product",
      },
    },
    { $unwind: "$product" },
    {
      $project: {
        productId: "$product._id",
        name: "$product.name",
        totalSold: 1,
        _id: 0,
      },
    },
  ]);

  return { period: label, products: result };
};

const getSalesStatistics = async (req, res, next) => {
  try {
    const simulateMonthsAhead = 0;
    const now = new Date();
    now.setMonth(now.getMonth() + simulateMonthsAhead);

    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());

    const startOfMonth = new Date(startOfToday.getFullYear(), startOfToday.getMonth(), 1);

    const past7Days = new Date(startOfToday);
    past7Days.setDate(startOfToday.getDate() - 6);

    const past7Weeks = new Date(startOfToday);
    past7Weeks.setDate(startOfToday.getDate() - 7 * 6);

    const past12Months = new Date(startOfToday);
    past12Months.setMonth(startOfToday.getMonth() - 11);

    const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(startOfCurrentMonth);
    startOfLastMonth.setMonth(startOfCurrentMonth.getMonth() - 1);
    const endOfLastMonth = new Date(startOfCurrentMonth);

    const endOfCurrentMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const [
      [totalSalesStats],
      activeProducts,
      dailySales,
      weeklySales,
      monthlySales,
      topSellingResults,
      [lastMonthStats],
      [inventoryValueResult],
      [lastMonthInventoryValueResult],
      lowStockCount,
      lowStockLastMonth,
      lastMonthActiveProducts,
    ] = await Promise.all([
      Transactions.aggregate([
        { $match: { status: "completed", createdAt: { $gte: startOfCurrentMonth, $lt: endOfCurrentMonth } } },
        { $group: { _id: null, totalSales: { $sum: 1 }, totalIncome: { $sum: "$total" } } },
      ]),
      Products.countDocuments({
        quantityRemaining: { $gt: 0 },
        is_deleted: false,
        updatedAt: { $gte: startOfCurrentMonth, $lt: endOfCurrentMonth },
      }),
      Transactions.aggregate([
        { $match: { status: "completed", createdAt: { $gte: past7Days } } },
        { $group: { _id: { $dayOfWeek: "$createdAt" }, amount: { $sum: "$total" } } },
        {
          $addFields: {
            day: {
              $let: {
                vars: { days: [null, "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] },
                in: { $arrayElemAt: ["$$days", "$_id"] },
              },
            },
          },
        },
        { $project: { day: 1, amount: 1, _id: 0 } },
      ]),
      Transactions.aggregate([
        { $match: { status: "completed", createdAt: { $gte: past7Weeks } } },
        {
          $group: {
            _id: { year: { $year: "$createdAt" }, week: { $isoWeek: "$createdAt" } },
            amount: { $sum: "$total" },
          },
        },
        { $sort: { "_id.year": 1, "_id.week": 1 } },
        {
          $project: {
            week: { $concat: [{ $toString: "$_id.year" }, "-W", { $toString: "$_id.week" }] },
            amount: 1,
            _id: 0,
          },
        },
      ]),
      Transactions.aggregate([
        { $match: { status: "completed", createdAt: { $gte: past12Months } } },
        {
          $group: {
            _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } },
            amount: { $sum: "$total" },
          },
        },
        { $sort: { "_id.year": 1, "_id.month": 1 } },
        {
          $project: {
            month: {
              $concat: [
                { $toString: "$_id.year" },
                "-",
                {
                  $cond: [
                    { $lt: ["$_id.month", 10] },
                    { $concat: ["0", { $toString: "$_id.month" }] },
                    { $toString: "$_id.month" },
                  ],
                },
              ],
            },
            amount: 1,
            _id: 0,
          },
        },
      ]),
      Promise.all([
        getTopSellingProducts(startOfToday, "day"),
        getTopSellingProducts(startOfWeek, "week"),
        getTopSellingProducts(startOfMonth, "month"),
      ]),
      Transactions.aggregate([
        { $match: { status: "completed", createdAt: { $gte: startOfLastMonth, $lt: endOfLastMonth } } },
        { $group: { _id: null, totalSales: { $sum: 1 }, totalIncome: { $sum: "$total" } } },
      ]),
      Products.aggregate([
        { $match: { quantityRemaining: { $gt: 0 }, is_deleted: false } },
        { $group: { _id: null, totalInventoryValue: { $sum: { $multiply: ["$quantityRemaining", "$price"] } } } },
      ]),
      Products.aggregate([
        { $match: { quantityRemaining: { $gt: 0 }, is_deleted: false, updatedAt: { $gte: startOfLastMonth, $lt: endOfLastMonth } } },
        { $group: { _id: null, totalInventoryValue: { $sum: { $multiply: ["$quantityRemaining", "$price"] } } } },
      ]),
      Products.countDocuments({
        $expr: { $lte: ["$quantityRemaining", "$quantityThreshold"] },
        is_deleted: false,
        updatedAt: { $gte: startOfCurrentMonth, $lt: endOfCurrentMonth },
      }),
      Products.countDocuments({
        $expr: { $lte: ["$quantityRemaining", "$quantityThreshold"] },
        is_deleted: false,
        updatedAt: { $gte: startOfLastMonth, $lt: endOfLastMonth },
      }),
      Products.countDocuments({
        quantityRemaining: { $gt: 0 },
        is_deleted: false,
        updatedAt: { $gte: startOfLastMonth, $lt: endOfLastMonth },
      }),
    ]);

    const [topDaily, topWeekly, topMonthly] = topSellingResults;

    const totalInventoryValue = inventoryValueResult?.totalInventoryValue || 0;
    const lastMonthInventoryValue = lastMonthInventoryValueResult?.totalInventoryValue || 0;

    const inventoryValueTrend =
      lastMonthInventoryValue === 0
        ? 100
        : ((totalInventoryValue - lastMonthInventoryValue) / lastMonthInventoryValue) * 100;

    const currentSales = totalSalesStats?.totalSales || 0;
    const currentIncome = totalSalesStats?.totalIncome || 0;
    const lastSales = lastMonthStats?.totalSales || 0;
    const lastIncome = lastMonthStats?.totalIncome || 0;

    const salesTrend = lastSales === 0 ? 100 : ((currentSales - lastSales) / lastSales) * 100;
    const incomeTrend = lastIncome === 0 ? 100 : ((currentIncome - lastIncome) / lastIncome) * 100;

    const activeProductTrend =
      lastMonthActiveProducts === 0
        ? 100
        : ((activeProducts - lastMonthActiveProducts) / lastMonthActiveProducts) * 100;

    const allDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    const paddedDailySales = allDays.map(day => {
      const found = dailySales.find(sale => sale.day === day);
      return { day, amount: found ? found.amount : 0 };
    });

    const paddedWeeklySales = [];

    for (let i = 6; i >= 0; i--) {
      const weekDate = new Date();
      weekDate.setDate(weekDate.getDate() - i * 7);
      const year = weekDate.getFullYear();
      const week = getISOWeek(weekDate); // e.g. 22
      const key = `${year}-W${week}`;

      const found = weeklySales.find(w => w.week === key);
      paddedWeeklySales.push({ week: key, amount: found ? found.amount : 0 });
    }

    // helper to get ISO week number
    function getISOWeek(date) {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() + 4 - (d.getDay() || 7));
      const yearStart = new Date(d.getFullYear(), 0, 1);
      return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    }

    const paddedMonthlySales = [];

    for (let i = 11; i >= 0; i--) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      const year = date.getFullYear();
      const month = (date.getMonth() + 1).toString().padStart(2, "0");
      const key = `${year}-${month}`;

      const found = monthlySales.find(m => m.month === key);
      paddedMonthlySales.push({ month: key, amount: found ? found.amount : 0 });
    }

    const lowStockTrend =
      lowStockLastMonth === 0
      ? 100
      : ((lowStockCount - lowStockLastMonth) / lowStockLastMonth) * 100;

    return res.json({
      status: "success",
      data: {
        simulated_month: simulateMonthsAhead,
        total_sales: currentSales,
        total_income: currentIncome,
        total_expenses: 0,
        active_products: activeProducts,
        low_stock: lowStockCount,
        total_inventory_value: totalInventoryValue,
        trends: {
          total_sales: salesTrend,
          total_income: incomeTrend,
          active_products: activeProductTrend,
          low_stock: lowStockTrend,
          total_inventory_value: inventoryValueTrend,
        },
        daily_sales: paddedDailySales,
        weekly_sales: paddedWeeklySales,
        monthly_sales: paddedMonthlySales,
        top_selling_products_by_period: {
          day: topDaily.products,
          week: topWeekly.products,
          month: topMonthly.products,
        },
      },
    });

  } catch (err) {
    console.error("Sales statistics error:", err);
    return res.status(500).json({ status: "failed", message: err.message });
  }
}


const getAllTransactions = async (req, res) => {
  try {
    const transactions = await Transactions.find()
      .populate("cashier", "name")
      .populate("partsman", "name")
      .populate("items._id", "name")
      .lean();

    return res.status(200).json({
      status: "success",
      data: transactions,
    });
  } catch (error) {
    return res.status(500).json({
      status: "failed",
      message: error.message,
    });
  }
};


module.exports = {
  getTransactions,
  createTransaction,
  updateTransaction,
  getUserTransactions,
  getMyTransactionStatistics,
  cancelTransaction,
  getSalesStatistics,
  returnTransaction,
  getAllTransactions,
};
