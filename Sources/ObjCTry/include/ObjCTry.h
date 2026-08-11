#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Runs the block, catching any NSException (Swift cannot catch these).
/// Returns the exception's description, or nil on success.
NSString * _Nullable TiroCatchException(void (NS_NOESCAPE ^block)(void));

NS_ASSUME_NONNULL_END
