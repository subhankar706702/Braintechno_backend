import mongoose, {
    Schema
} from 'mongoose';

export const CUSTOMER_TYPES = [
    'New',
    'Regular',
    'VIP',
    'Interested',
    'Followup',
    'Converted'
] as const;

export const CUSTOMER_SOURCES = [
    'Facebook',
    'WhatsApp',
    'Manual',
    'Excel',
    'AI',
    'Instagram',
    'Direct',
    'Campaign'
] as const;

export const DEFAULT_CUSTOMER_TYPE = CUSTOMER_TYPES[0];

export const DEFAULT_CUSTOMER_SOURCE =
    CUSTOMER_SOURCES.find(source => source === 'Manual') ??
    CUSTOMER_SOURCES[0];


const customerSchema = new Schema(
    {
        accountId: {
            type: String,
            required: true,
            trim: true,
            index: true
        },

        businessId: {
            type: Schema.Types.ObjectId,
            ref: 'Business',
            required: false,
            index: true
        },

        name: {
            type: String,
            default: '',
            trim: true
        },

        mobile: {
            type: String,
            default: '',
            trim: true
        },

        mobileNormalized: {
            type: String,
            default: '',
            index: true
        },

        email: {
            type: String,
            default: '',
            trim: true,
            lowercase: true
        },

        emailNormalized: {
            type: String,
            default: '',
            index: true
        },

        customerType: {
            type: String,
            enum: CUSTOMER_TYPES,
            default: DEFAULT_CUSTOMER_TYPE,
            index: true
        },

        source: {
            type: String,
            enum: CUSTOMER_SOURCES,
            default: DEFAULT_CUSTOMER_SOURCE,
            index: true
        },

        image: {
            type: String,
            default: '',
            trim: true
        },

        lastContactAt: {
            type: Date,
            default: null
        }
    },
    {
        timestamps: true
    }
);


customerSchema.index({
    accountId: 1,
    createdAt: -1
});

customerSchema.index({
    accountId: 1,
    customerType: 1,
    source: 1
});

customerSchema.index(
    {
        accountId: 1,
        mobileNormalized: 1
    },
    {
        unique: true,
        partialFilterExpression: {
            mobileNormalized: {
                $type: 'string',
                $gt: ''
            }
        }
    }
);

customerSchema.index(
    {
        accountId: 1,
        emailNormalized: 1
    },
    {
        unique: true,
        partialFilterExpression: {
            emailNormalized: {
                $type: 'string',
                $gt: ''
            }
        }
    }
);


export const Customer =
    mongoose.models.Customer ||
    mongoose.model('Customer', customerSchema);